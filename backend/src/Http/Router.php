<?php

declare(strict_types=1);

namespace Cuvylo\Http;

final class Router
{
    /** @var list<array{method: string, regex: string, handler: callable, auth: bool}> */
    private array $routes = [];

    public function add(string $method, string $pattern, callable $handler, bool $auth = true): void
    {
        $regex = preg_replace('#\{[A-Za-z_][A-Za-z0-9_]*\}#', '([^/]+)', $pattern);
        $this->routes[] = [
            'method' => $method,
            'regex' => '#^' . $regex . '$#',
            'handler' => $handler,
            'auth' => $auth,
            'names' => self::paramNames($pattern),
        ];
    }

    /**
     * @return array{handler: callable, auth: bool, params: array<string, string>}
     * @throws HttpException 404 ou 405
     */
    public function match(string $method, string $path): array
    {
        $allowed = [];
        foreach ($this->routes as $route) {
            if (preg_match($route['regex'], $path, $m) !== 1) {
                continue;
            }
            if ($route['method'] !== $method) {
                $allowed[] = $route['method'];
                continue;
            }
            array_shift($m);

            return [
                'handler' => $route['handler'],
                'auth' => $route['auth'],
                'params' => array_combine($route['names'], array_map('rawurldecode', $m)),
            ];
        }

        if ($allowed !== []) {
            throw new HttpException(405, 'method_not_allowed', 'Méthode non autorisée.', [], ['Allow' => implode(', ', array_unique($allowed))]);
        }

        throw HttpException::notFound();
    }

    /** @return list<string> */
    private static function paramNames(string $pattern): array
    {
        preg_match_all('#\{([A-Za-z_][A-Za-z0-9_]*)\}#', $pattern, $m);

        return $m[1];
    }
}
