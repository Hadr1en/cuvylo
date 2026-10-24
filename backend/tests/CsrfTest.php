<?php

declare(strict_types=1);

namespace Cuvylo\Tests;

use Cuvylo\Auth\Csrf;
use Cuvylo\Http\Request;
use Cuvylo\Tests\Support\ApiTestCase;

final class CsrfTest extends ApiTestCase
{
    public function testWriteWithoutCsrfTokenIsRejected(): void
    {
        $client = $this->client();
        $client->autoCsrf = false;
        $response = $client->post('/api/auth/login', ['email' => 'a@example.test', 'password' => 'x']);
        $this->assertSame(403, $response->status);
        $this->assertSame('forbidden', $response->data()['error']['code']);
    }

    public function testCsrfEndpointIssuesSignedTokenAndCookie(): void
    {
        $client = $this->client();
        $response = $client->get('/api/csrf');
        $this->assertSame(200, $response->status);

        $token = $response->data()['csrfToken'];
        $name = $this->cookies->csrfName();
        $this->assertSame('__Host-' . Csrf::COOKIE, $name);
        $this->assertSame($token, $response->cookies()[$name]['value']);
        $this->assertTrue((new Csrf($this->config))->isGenuine($token));
        $this->assertFalse($response->cookies()[$name]['options']['httponly']);
        $this->assertTrue($response->cookies()[$name]['options']['secure']);
    }

    public function testMismatchBetweenCookieAndHeaderIsRejected(): void
    {
        $client = $this->client();
        $client->get('/api/csrf');
        $other = (new Csrf($this->config))->issue();

        $response = $client->send('POST', '/api/auth/login', ['email' => 'a@example.test', 'password' => 'x'], [Csrf::HEADER => $other]);
        $this->assertSame(403, $response->status);
    }

    public function testForgedMatchingPairWithoutValidSignatureIsRejected(): void
    {
        // Un attaquant qui sait poser un cookie (sous-domaine) ne peut pas fabriquer un jeton signé.
        $client = $this->client();
        $forged = bin2hex(random_bytes(16)) . '.' . str_repeat('0', 64);
        $client->jar[Csrf::COOKIE] = $forged;

        $response = $client->send('POST', '/api/auth/login', ['email' => 'a@example.test', 'password' => 'x'], [Csrf::HEADER => $forged]);
        $this->assertSame(403, $response->status);
    }

    public function testTokenSignedWithAnotherKeyIsRejected(): void
    {
        $other = new Csrf(\Cuvylo\Config::fromEnv([
            'APP_ENV' => 'testing', 'APP_URL' => 'https://cv.example.test',
            'APP_KEY' => base64_encode(str_repeat('z', 32)), 'DB_DSN' => 'sqlite::memory:',
        ]));
        $token = $other->issue();
        $client = $this->client();
        $client->jar[Csrf::COOKIE] = $token;

        $this->assertSame(403, $client->send('POST', '/api/auth/login', ['email' => 'a@example.test', 'password' => 'x'], [Csrf::HEADER => $token])->status);
    }

    public function testForeignOriginIsRejectedEvenWithValidToken(): void
    {
        $client = $this->client();
        $response = $client->send('POST', '/api/auth/login', ['email' => 'a@example.test', 'password' => 'x'], ['origin' => 'https://evil.example']);
        $this->assertSame(403, $response->status);

        $nullOrigin = $this->client()->send('POST', '/api/auth/login', ['email' => 'a@example.test', 'password' => 'x'], ['origin' => 'null']);
        $this->assertSame(403, $nullOrigin->status);

        $crossSite = $this->client()->send('POST', '/api/auth/login', ['email' => 'a@example.test', 'password' => 'x'], ['sec-fetch-site' => 'cross-site']);
        $this->assertSame(403, $crossSite->status);
    }

    public function testAuthenticatedWriteRequiresTokenBoundToSession(): void
    {
        [$alice] = $this->registeredClient();
        [$bob] = $this->registeredClient();

        // Jeton parfaitement signé, mais émis pour la session de Bob : refusé sur la session d'Alice.
        $bobToken = $bob->csrfToken();
        $alice->jar[Csrf::COOKIE] = $bobToken;
        $response = $alice->send('PUT', '/api/profile', ['data' => self::sampleProfile()], [Csrf::HEADER => $bobToken]);
        $this->assertSame(403, $response->status);

        // Après resynchronisation via GET /api/csrf, Alice peut écrire.
        unset($alice->jar[Csrf::COOKIE]);
        $this->assertSame(200, $alice->put('/api/profile', ['data' => self::sampleProfile()])->status);
    }

    public function testCsrfEndpointKeepsExistingTokenAcrossCalls(): void
    {
        [$client] = $this->registeredClient();
        $first = $client->csrfToken();
        $this->assertSame($first, $client->get('/api/csrf')->data()['csrfToken'], 'pas de rotation intempestive entre onglets');
    }

    public function testUnauthenticatedRequestIsReportedBeforeCsrfOnProtectedRoutes(): void
    {
        $client = $this->client();
        $client->autoCsrf = false;
        $this->assertSame(401, $client->put('/api/profile', ['data' => []])->status);
    }

    public function testSafeMethodsDoNotNeedCsrf(): void
    {
        $client = $this->client();
        $client->autoCsrf = false;
        $this->assertSame(200, $client->get('/api/health')->status);
    }

    /** Pare-feu des mutualisés (ModSecurity) qui refuse PUT/DELETE : POST + X-HTTP-Method-Override. */
    public function testPostWithMethodOverrideActsAsPutOrDeleteWithTheSameCsrfRules(): void
    {
        [$client] = $this->registeredClient();
        $put = ['x-http-method-override' => 'PUT'];
        $saved = $client->send('POST', '/api/profile', ['data' => self::sampleProfileV2()], $put);
        $this->assertSame(200, $saved->status, $saved->body());
        $this->assertSame(self::sampleProfileV2()['summary'], $client->get('/api/profile')->data()['data']['summary']);

        $cv = $this->createCv($client);
        $this->assertSame(204, $client->send('POST', "/api/cvs/$cv", null, ['x-http-method-override' => 'delete'])->status);
        $this->assertSame(404, $client->get("/api/cvs/$cv")->status);

        $client->autoCsrf = false;
        $this->assertSame(403, $client->send('POST', '/api/profile', ['data' => self::sampleProfileV2()], $put)->status, 'CSRF exigé comme pour un PUT');
        $this->assertSame(200, $client->send('GET', '/api/profile', null, ['x-http-method-override' => 'DELETE'])->status, 'un GET ne se convertit pas');
        $this->assertSame('POST', Request::effectiveMethod('post', 'GET'), 'seuls PUT, PATCH et DELETE');
    }
}
