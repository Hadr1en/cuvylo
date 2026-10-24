<?php

declare(strict_types=1);

namespace Cuvylo\Controller;

use Cuvylo\Domain\EmptyProfile;
use Cuvylo\Http\HttpException;
use Cuvylo\Http\Request;
use Cuvylo\Http\Response;
use Cuvylo\Repository\ProfileRepository;
use Cuvylo\Repository\UsageRepository;
use Cuvylo\Support\Clock;
use Cuvylo\Support\Json;
use Cuvylo\Validation\Fields;
use Cuvylo\Validation\ProfileValidator;

final class ProfileController
{
    public function __construct(
        private readonly ProfileRepository $profiles,
        private readonly ProfileValidator $validator,
        private readonly UsageRepository $usage,
        private readonly Clock $clock,
    ) {
    }

    public function show(Request $request): Response
    {
        return Response::json(self::json($this->current($request)));
    }

    /**
     * Document complet. `revision` (facultatif) : révision connue du client ; si elle n'est plus courante → 409
     * `conflict` avec `error.current` (état serveur). Sans `revision` : écriture acceptée (compatibilité).
     */
    public function update(Request $request): Response
    {
        $userId = $request->attribute('user')['id'];
        $f = new Fields();
        $body = $f->assoc($request->json(), '', ['data'], ['revision']);
        $revision = self::revision($f, $body);
        $f->assertOk();

        $data = $this->validator->validate($body['data'] ?? null, 'data');
        $current = $this->current($request);

        if ($revision !== null && $revision !== $current['revision']) {
            throw HttpException::conflict('Le profil a été modifié ailleurs.', self::json($current));
        }
        $this->usage->assertCanGrow($userId, strlen(Json::encode($data)) - $current['bytes']);

        if (!$this->profiles->save($userId, $data, $this->clock->sql(), $revision)) {
            throw HttpException::conflict('Le profil a été modifié ailleurs.', self::json($this->current($request)));
        }

        return Response::json(self::json($this->current($request)));
    }

    /** @return array{data: array<string, mixed>, updated_at: string, revision: int, bytes: int} */
    private function current(Request $request): array
    {
        $user = $request->attribute('user');
        $profile = $this->profiles->find($user['id']);
        if ($profile === null) {
            // Compte antérieur à la création automatique du profil : on le crée à la volée.
            $this->profiles->save($user['id'], EmptyProfile::create($user['email']), $this->clock->sql());
            $profile = $this->profiles->find($user['id']);
        }

        /** @var array{data: array<string, mixed>, updated_at: string, revision: int, bytes: int} $profile */
        return $profile;
    }

    /**
     * Révision facultative d'un corps d'écriture (`null` ou absente : pas de contrôle de concurrence).
     *
     * @param array<string, mixed>|null $body
     */
    public static function revision(Fields $f, ?array $body): ?int
    {
        if ($body === null || ($body['revision'] ?? null) === null) {
            return null;
        }

        return $f->int($body['revision'], 'revision', 0, PHP_INT_MAX);
    }

    /** @param array{data: array<string, mixed>, updated_at: string, revision: int} $profile */
    private static function json(array $profile): array
    {
        return ['data' => $profile['data'], 'updatedAt' => Clock::sqlToIso($profile['updated_at']), 'revision' => $profile['revision']];
    }
}
