<?php

declare(strict_types=1);

namespace Cuvylo\Controller;

use Cuvylo\Config;
use Cuvylo\Domain\PublicSnapshot;
use Cuvylo\Http\HttpException;
use Cuvylo\Http\Request;
use Cuvylo\Http\Response;
use Cuvylo\Repository\CvRepository;
use Cuvylo\Repository\ShareRepository;
use Cuvylo\Repository\UsageRepository;
use Cuvylo\Support\Clock;
use Cuvylo\Support\Json;
use Cuvylo\Support\StoredJson;
use Cuvylo\Support\Token;
use Cuvylo\Support\Ulid;
use Cuvylo\Validation\Fields;

/** Liens de partage en lecture seule : instantané figé, expiration facultative, révocation, compteur de vues. */
final class ShareController
{
    public const SLUG_LENGTH = 22;

    public function __construct(
        private readonly Config $config,
        private readonly CvRepository $cvs,
        private readonly ShareRepository $shares,
        private readonly UsageRepository $usage,
        private readonly Clock $clock,
    ) {
    }

    public function index(Request $request, array $params): Response
    {
        $userId = $this->userId($request);
        $cv = $this->ownedCv($userId, $params);

        return Response::json(['shares' => array_map(fn (array $row): array => $this->json($row), $this->shares->listFor($userId, $cv['id']))]);
    }

    public function create(Request $request, array $params): Response
    {
        $userId = $this->userId($request);
        $cv = $this->ownedCv($userId, $params);

        $f = new Fields();
        $body = $f->assoc($request->jsonOrEmpty(), '', [], ['expiresInDays']) ?? [];
        $days = null;
        if (($body['expiresInDays'] ?? null) !== null) {
            $days = $f->int($body['expiresInDays'], 'expiresInDays', 1, 365);
        }
        $f->assertOk();

        $now = $this->clock->now();
        if ($this->shares->countActive($userId, $cv['id'], $this->clock->sql($now)) >= ShareRepository::MAX_ACTIVE_PER_CV) {
            throw HttpException::conflict('Nombre maximal de liens actifs atteint pour ce CV (' . ShareRepository::MAX_ACTIVE_PER_CV . ').');
        }

        // Instantané public : seulement ce que le PDF affiche, anonymisé si demandé. Rien d'autre n'est stocké.
        $data = PublicSnapshot::build($cv['data'], $cv['settings']);
        $title = PublicSnapshot::title((string) $cv['title'], $cv['settings']);
        $this->usage->assertCanGrow($userId, strlen(Json::encode($cv['settings'])) + strlen(StoredJson::encode($data, true)));

        $id = Ulid::generate($now);
        $slug = Token::generate(16);
        $expiresAt = $days === null ? null : $this->clock->sql($now + $days * 86400);
        $this->shares->create($id, $userId, $cv['id'], $slug, $title, $cv['settings'], $data, $this->clock->sql($now), $expiresAt);

        return Response::json(['share' => $this->json((array) $this->shares->find($userId, $id))], 201);
    }

    public function destroy(Request $request, array $params): Response
    {
        $id = (string) ($params['id'] ?? '');
        if (!Ulid::isValid($id) || !$this->shares->revoke($this->userId($request), $id, $this->clock->sql())) {
            throw HttpException::notFound();
        }

        return Response::noContent();
    }

    /** Lecture publique (sans session) : 404 si inconnu, révoqué ou expiré. Le compteur de vues ne garde pas d'IP. */
    public function show(Request $request, array $params): Response
    {
        $slug = (string) ($params['slug'] ?? '');
        $this->shares->purgeExpired($this->clock->sql());
        $share = Token::looksValid($slug, self::SLUG_LENGTH) ? $this->shares->findPublic($slug, $this->clock->sql()) : null;
        if ($share === null) {
            throw HttpException::notFound();
        }
        $this->shares->incrementViews($share['id']);

        // Déjà filtré à la création ; refiltré ici pour les partages créés avant cette règle.
        $data = PublicSnapshot::build($share['data'], $share['settings']);

        return Response::json([
            'title' => PublicSnapshot::title((string) $share['title'], $share['settings']),
            'settings' => $share['settings'],
            'data' => $data,
            'sharedAt' => Clock::sqlToIso($share['created_at']),
        ], 200, ['X-Robots-Tag' => 'noindex, nofollow']);
    }

    /** @param array<string, mixed> $row */
    private function json(array $row): array
    {
        return [
            'id' => $row['id'],
            'slug' => $row['slug'],
            'url' => $this->config->appUrl . '/p/' . $row['slug'],
            'createdAt' => Clock::sqlToIso($row['created_at']),
            'expiresAt' => $row['expires_at'] === null ? null : Clock::sqlToIso($row['expires_at']),
            'views' => (int) $row['views'],
        ];
    }

    /** @return array<string, mixed> */
    private function ownedCv(string $userId, array $params): array
    {
        $id = (string) ($params['id'] ?? '');
        $cv = Ulid::isValid($id) ? $this->cvs->find($userId, $id) : null;
        if ($cv === null) {
            throw HttpException::notFound();
        }

        return $cv;
    }

    private function userId(Request $request): string
    {
        return $request->attribute('user')['id'];
    }
}
