<?php

declare(strict_types=1);

namespace Cuvylo\Controller;

use Cuvylo\Http\HttpException;
use Cuvylo\Http\Request;
use Cuvylo\Http\Response;
use Cuvylo\Repository\CvRepository;
use Cuvylo\Repository\LetterRepository;
use Cuvylo\Repository\UsageRepository;
use Cuvylo\Support\Clock;
use Cuvylo\Support\Ulid;
use Cuvylo\Validation\Fields;
use Cuvylo\Validation\LetterValidator;
use Cuvylo\Validation\ValidationException;

/** Lettres de motivation (CRUD, contrôle de concurrence par `revision`). */
final class LetterController
{
    public function __construct(
        private readonly LetterRepository $letters,
        private readonly CvRepository $cvs,
        private readonly LetterValidator $validator,
        private readonly UsageRepository $usage,
        private readonly Clock $clock,
    ) {
    }

    public function index(Request $request): Response
    {
        return Response::json(['letters' => $this->letters->all($this->userId($request))]);
    }

    public function show(Request $request, array $params): Response
    {
        return Response::json(['letter' => $this->owned($request, $params)]);
    }

    public function create(Request $request): Response
    {
        $userId = $this->userId($request);
        $value = $this->validator->validate($request->json(), false);
        $this->assertCvOwned($userId, $value['cvId']);

        if ($this->letters->count($userId) >= LetterRepository::MAX_PER_USER) {
            throw HttpException::conflict('Nombre maximal de lettres atteint (' . LetterRepository::MAX_PER_USER . ').');
        }
        $this->usage->assertCanGrow($userId, LetterRepository::bytes($value));

        $now = $this->clock->now();
        $id = Ulid::generate($now);
        $this->letters->insert($userId, $id, $value, $this->clock->sql($now));

        return Response::json(['letter' => $this->letters->find($userId, $id)], 201);
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
            throw HttpException::conflict('La lettre a été modifiée ailleurs.', $current);
        }
        $this->usage->assertCanGrow($userId, LetterRepository::bytes($value) - LetterRepository::bytes($current));
        if (!$this->letters->update($userId, $current['id'], $value, $this->clock->sql(), $revision)) {
            throw HttpException::conflict('La lettre a été modifiée ailleurs.', $this->letters->find($userId, $current['id']));
        }

        return Response::json(['letter' => $this->letters->find($userId, $current['id'])]);
    }

    public function destroy(Request $request, array $params): Response
    {
        $current = $this->owned($request, $params);
        $this->letters->delete($this->userId($request), $current['id']);

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
        $found = Ulid::isValid($id) ? $this->letters->find($this->userId($request), $id) : null;
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
