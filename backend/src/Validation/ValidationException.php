<?php

declare(strict_types=1);

namespace Cuvylo\Validation;

use Cuvylo\Http\HttpException;

final class ValidationException extends HttpException
{
    /** @param array<string, string> $fields Chemin pointé → code (`experiences.0.startDate` → `invalid_date`), 50 au plus */
    public function __construct(array $fields)
    {
        parent::__construct(422, 'validation_failed', 'Les données envoyées sont invalides.', array_slice($fields, 0, Fields::MAX_ERRORS, true));
    }
}
