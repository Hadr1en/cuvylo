<?php

declare(strict_types=1);

namespace Cuvylo\Controller;

use Cuvylo\Http\HttpException;
use Cuvylo\Http\Request;
use Cuvylo\Http\Response;
use Cuvylo\Repository\ApplicationRepository;
use Cuvylo\Repository\CvRepository;
use Cuvylo\Repository\UsageRepository;
use Cuvylo\Support\Clock;
use Cuvylo\Support\Ulid;
use Cuvylo\Validation\ApplicationValidator;
use Cuvylo\Validation\Fields;
use Cuvylo\Validation\ValidationException;

/** Suivi des candidatures (CRUD, contrôle de concurrence par `revision`). */
final class ApplicationController
{
    public function __construct(
        private readonly ApplicationRepository $applications,
        private readonly CvRepository $cvs,
        private readonly ApplicationValidator $validator,
        private readonly UsageRepository $usage,
        private readonly Clock $clock,
    ) {
    }

    public function index(Request $request): Response
    {
        return Response::json(['applications' => $this->applications->all($this->userId($request))]);
    }

    public function show(Request $request, array $params): Response
    {
        return Response::json(['application' => $this->owned($request, $params)]);
    }

    public function create(Request $request): Response
    {
        $userId = $this->userId($request);
        $value = $this->validator->validate($request->json(), false);
        $this->assertCvOwned($userId, $value['cvId']);

        if ($this->applications->count($userId) >= ApplicationRepository::MAX_PER_USER) {
            throw HttpException::conflict('Nombre maximal de candidatures atteint (' . ApplicationRepository::MAX_PER_USER . ').');
        }
        $this->usage->assertCanGrow($userId, ApplicationRepository::bytes($value));

        $now = $this->clock->now();
        $id = Ulid::generate($now);
        $this->applications->insert($userId, $id, $value, $this->clock->sql($now));

        return Response::json(['application' => $this->applications->find($userId, $id)], 201);
    }

    public function update(Request $request, array $params): Response
    {
        $userId = $this->userId($request);
        $current = $this->owned($request, $params);
        $body = $request->json();
        $value = $this->validator->validate($body, true);
        $f = new Fields();
        $revision = ProfileController::revision($f, is_array($body) ? $body : null);
        $f->assertOk();
        $this->assertCvOwned($userId, $value['cvId']);

        if ($revision !== null && $revision !== $current['revision']) {
            throw HttpException::conflict('La candidature a été modifiée ailleurs.', $current);
        }
        $this->usage->assertCanGrow($userId, ApplicationRepository::bytes($value) - ApplicationRepository::bytes($current));
        if (!$this->applications->update($userId, $current['id'], $value, $this->clock->sql(), $revision)) {
            throw HttpException::conflict('La candidature a été modifiée ailleurs.', $this->applications->find($userId, $current['id']));
        }

        return Response::json(['application' => $this->applications->find($userId, $current['id'])]);
    }

    public function destroy(Request $request, array $params): Response
    {
        $current = $this->owned($request, $params);
        $this->applications->delete($this->userId($request), $current['id']);

        return Response::noContent();
    }

    private function assertCvOwned(string $userId, ?string $cvId): void
    {
        if ($cvId !== null && $this->cvs->find($userId, $cvId) === null) {
            throw new ValidationException(['cvId' => 'invalid_reference']);
        }
    }

    /** @return array<string, mixed> */
    private function owned(Request $request, array $params): array
    {
        $id = (string) ($params['id'] ?? '');
        $found = Ulid::isValid($id) ? $this->applications->find($this->userId($request), $id) : null;
        if ($found === null) {
            throw HttpException::notFound();
        }

        return $found;
    }

    private function userId(Request $request): string
    {
        return $request->attribute('user')['id'];
    }
}
