<?php

declare(strict_types=1);

namespace Cuvylo\Controller;

use Cuvylo\Domain\EmptyProfile;
use Cuvylo\Http\HttpException;
use Cuvylo\Http\Request;
use Cuvylo\Http\Response;
use Cuvylo\Repository\CvRepository;
use Cuvylo\Repository\ProfileRepository;
use Cuvylo\Repository\UsageRepository;
use Cuvylo\Support\Clock;
use Cuvylo\Support\Json;
use Cuvylo\Support\Ulid;
use Cuvylo\Validation\CvSettingsValidator;
use Cuvylo\Validation\Fields;
use Cuvylo\Validation\ProfileValidator;

final class CvController
{
    /** Délai minimal entre deux versions automatiques. */
    public const AUTO_VERSION_INTERVAL = 600;

    /** Délai minimal entre deux versions manuelles d'un même CV. */
    public const MANUAL_VERSION_INTERVAL = 20;

    public const AUTO_LABEL = 'auto';
    public const RESTORE_LABEL = 'avant restauration';

    public function __construct(
        private readonly CvRepository $cvs,
        private readonly ProfileRepository $profiles,
        private readonly ProfileValidator $profileValidator,
        private readonly CvSettingsValidator $settingsValidator,
        private readonly UsageRepository $usage,
        private readonly Clock $clock,
    ) {
    }

    public function index(Request $request): Response
    {
        return Response::json(['cvs' => $this->cvs->summaries($this->userId($request))]);
    }

    public function create(Request $request): Response
    {
        $userId = $this->userId($request);
        $f = new Fields();
        $body = $f->assoc($request->json(), '', ['title'], ['kind', 'source', 'settings']) ?? [];

        $title = $this->title($f, $body['title'] ?? null, 'title');
        $kind = array_key_exists('kind', $body) ? $f->enum($body['kind'], 'kind', ['base', 'tailored']) : 'base';

        $sourceCvId = null;
        if (array_key_exists('source', $body)) {
            $source = $f->assoc($body['source'], 'source', ['type'], ['id']);
            $type = $source === null ? null : $f->enum($source['type'] ?? null, 'source.type', ['profile', 'cv']);
            if ($type === 'cv') {
                $id = $source['id'] ?? null;
                if (!is_string($id) || !Ulid::isValid($id)) {
                    $f->error('source.id', is_string($id) ? 'invalid_id' : 'required');
                } else {
                    $sourceCvId = $id;
                }
            } elseif ($type === 'profile' && array_key_exists('id', $source)) {
                $f->error('source.id', 'unknown_field');
            }
        }

        $customSettings = null;
        if (array_key_exists('settings', $body)) {
            $this->settingsValidator->check($f, $body['settings'], 'settings');
        }
        $f->assertOk();
        if (array_key_exists('settings', $body)) {
            $customSettings = CvSettingsValidator::normalize($body['settings']);
        }

        if ($sourceCvId !== null) {
            $source = $this->cvs->find($userId, $sourceCvId);
            if ($source === null) {
                throw HttpException::notFound();
            }
            $data = $source['data'];
            $settings = $customSettings ?? $source['settings'];
        } else {
            $profile = $this->profiles->find($userId);
            $data = $profile['data'] ?? EmptyProfile::create();
            $settings = $customSettings ?? CvSettingsValidator::defaults();
        }

        if ($this->cvs->count($userId) >= CvRepository::MAX_CVS_PER_USER) {
            throw new HttpException(409, 'conflict', 'Nombre maximal de CV atteint (' . CvRepository::MAX_CVS_PER_USER . ').');
        }
        $this->usage->assertCanGrow($userId, strlen(Json::encode($settings)) + strlen(Json::encode($data)));

        $now = $this->clock->now();
        $id = Ulid::generate($now);
        $this->cvs->insert($userId, $id, (string) $title, (string) $kind, $settings, $data, $this->clock->sql($now));

        return Response::json(['cv' => $this->cvs->find($userId, $id)], 201);
    }

    public function show(Request $request, array $params): Response
    {
        return Response::json(['cv' => $this->owned($request, $params)]);
    }

    /**
     * Document complet. `revision` (facultatif) : si elle n'est plus courante → 409 `conflict` avec `error.current`.
     */
    public function update(Request $request, array $params): Response
    {
        $userId = $this->userId($request);
        $current = $this->owned($request, $params);

        $f = new Fields();
        $body = $f->assoc($request->json(), '', ['title', 'settings', 'data'], ['revision']) ?? [];
        $title = $this->title($f, $body['title'] ?? null, 'title');
        if (array_key_exists('settings', $body)) {
            $this->settingsValidator->check($f, $body['settings'], 'settings');
        }
        $revision = ProfileController::revision($f, $body);
        $f->assertOk();
        $data = $this->profileValidator->validate($body['data'] ?? null, 'data');
        /** @var array<string, mixed> $settings */
        $settings = CvSettingsValidator::normalize($body['settings']);

        if ($revision !== null && $revision !== $current['revision']) {
            throw HttpException::conflict('Le CV a été modifié ailleurs.', $current);
        }

        $changed = Json::canonical($current['data']) !== Json::canonical($data)
            || Json::canonical($current['settings']) !== Json::canonical($settings);
        $snapshot = $changed && $this->autoVersionDue($userId, $current['id']);

        $delta = strlen(Json::encode($settings)) + strlen(Json::encode($data)) - $this->cvs->storedBytes($userId, $current['id'])
            + ($snapshot ? CvRepository::versionBytes($current['settings'], $current['data']) : 0);
        $this->usage->assertCanGrow($userId, $delta);

        $updated = $this->cvs->transaction(function () use ($userId, $current, $settings, $data, $title, $snapshot, $revision): bool {
            if (!$this->cvs->update($userId, $current['id'], (string) $title, $settings, $data, $this->clock->sql(), $revision)) {
                return false;
            }
            if ($snapshot) {
                $this->snapshot($userId, $current, self::AUTO_LABEL, CvRepository::KIND_AUTO);
            }

            return true;
        });
        if (!$updated) {
            throw HttpException::conflict('Le CV a été modifié ailleurs.', $this->cvs->find($userId, $current['id']));
        }

        return Response::json(['cv' => $this->cvs->find($userId, $current['id'])]);
    }

    public function destroy(Request $request, array $params): Response
    {
        $cv = $this->owned($request, $params);
        $this->cvs->delete($this->userId($request), $cv['id']);

        return Response::noContent();
    }

    public function versions(Request $request, array $params): Response
    {
        $cv = $this->owned($request, $params);

        return Response::json(['versions' => $this->cvs->versions($this->userId($request), $cv['id'])]);
    }

    public function showVersion(Request $request, array $params): Response
    {
        $cv = $this->owned($request, $params);
        $version = $this->ownedVersion($request, $cv, $params);

        return Response::json(['version' => [
            'id' => $version['id'],
            'label' => $version['label'],
            'kind' => $version['kind'],
            'createdAt' => Clock::sqlToIso($version['created_at']),
            'settings' => $version['settings'],
            'data' => $version['data'],
        ]]);
    }

    public function createVersion(Request $request, array $params): Response
    {
        $userId = $this->userId($request);
        $cv = $this->owned($request, $params);

        $f = new Fields();
        $body = $f->assoc($request->json(), '', ['label']) ?? [];
        $label = $this->title($f, $body['label'] ?? null, 'label');
        $f->assertOk();

        $latest = $this->cvs->latestVersionAt($userId, $cv['id'], CvRepository::KIND_MANUAL);
        if ($latest !== null) {
            $wait = Clock::sqlToTimestamp($latest) + self::MANUAL_VERSION_INTERVAL - $this->clock->now();
            if ($wait > 0) {
                throw HttpException::rateLimited($wait, 'Une version vient d\'être enregistrée. Réessayez dans quelques secondes.');
            }
        }
        $this->usage->assertCanGrow($userId, CvRepository::versionBytes($cv['settings'], $cv['data']));

        $versionId = $this->snapshot($userId, $cv, (string) $label, CvRepository::KIND_MANUAL);
        $version = $this->cvs->findVersion($userId, $cv['id'], $versionId);

        return Response::json(['version' => [
            'id' => $versionId,
            'label' => $version['label'] ?? $label,
            'kind' => CvRepository::KIND_MANUAL,
            'createdAt' => Clock::sqlToIso($version['created_at'] ?? ''),
        ]], 201);
    }

    public function restore(Request $request, array $params): Response
    {
        $userId = $this->userId($request);
        $cv = $this->owned($request, $params);
        $version = $this->ownedVersion($request, $cv, $params);

        $this->usage->assertCanGrow($userId, CvRepository::versionBytes($cv['settings'], $cv['data']));
        $this->cvs->transaction(function () use ($userId, $cv, $version): void {
            $this->snapshot($userId, $cv, self::RESTORE_LABEL, CvRepository::KIND_RESTORE);
            $this->cvs->update($userId, $cv['id'], $cv['title'], $version['settings'], $version['data'], $this->clock->sql());
        });

        return Response::json(['cv' => $this->cvs->find($userId, $cv['id'])]);
    }

    /** @return array<string, mixed> */
    private function owned(Request $request, array $params): array
    {
        $id = $params['id'] ?? '';
        $cv = Ulid::isValid($id) ? $this->cvs->find($this->userId($request), $id) : null;
        if ($cv === null) {
            throw HttpException::notFound();
        }

        return $cv;
    }

    /**
     * @param array<string, mixed> $cv
     * @return array<string, mixed>
     */
    private function ownedVersion(Request $request, array $cv, array $params): array
    {
        $versionId = $params['vid'] ?? '';
        $version = Ulid::isValid($versionId) ? $this->cvs->findVersion($this->userId($request), $cv['id'], $versionId) : null;
        if ($version === null) {
            throw HttpException::notFound();
        }

        return $version;
    }

    private function userId(Request $request): string
    {
        return $request->attribute('user')['id'];
    }

    private function title(Fields $f, mixed $value, string $path): ?string
    {
        return $f->string(is_string($value) ? trim($value) : $value, $path, 120, false, 1);
    }

    private function autoVersionDue(string $userId, string $cvId): bool
    {
        $latest = $this->cvs->latestVersionAt($userId, $cvId);

        return $latest === null || Clock::sqlToTimestamp($latest) + self::AUTO_VERSION_INTERVAL <= $this->clock->now();
    }

    /** @param array<string, mixed> $cv */
    private function snapshot(string $userId, array $cv, string $label, string $kind): string
    {
        $now = $this->clock->now();
        $versionId = Ulid::generate($now);
        $this->cvs->addVersion($userId, $cv['id'], $versionId, $label, $kind, $cv['settings'], $cv['data'], $this->clock->sql($now));

        return $versionId;
    }
}
