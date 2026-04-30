<?php
/**
 * RiceGuard AI Expert
 *
 * Shared AI client + prompting helpers for rice disease guidance.
 */

define('RICEGUARD_AI_DEFAULT_PROVIDER', 'nvidia-nim');
define('RICEGUARD_AI_PROVIDER_NVIDIA', 'nvidia-nim');
define('RICEGUARD_AI_PROVIDER_OLLAMA', 'ollama');
define('RICEGUARD_AI_DEFAULT_BASE_URL', 'https://integrate.api.nvidia.com/v1');
define('RICEGUARD_AI_DEFAULT_MODEL', 'deepseek-ai/deepseek-v4-pro');
define('RICEGUARD_AI_OLLAMA_DEFAULT_BASE_URL', 'https://ollama.com/api');
define('RICEGUARD_AI_OLLAMA_DEFAULT_MODEL', 'qwen3.5:cloud');

require_once __DIR__ . '/weather_helper.php';
require_once __DIR__ . '/ai_regional_knowledge.php';

/**
 * Load key/value pairs from the project .env file.
 */
function riceguardLoadEnvMap() {
    static $env = null;

    if ($env !== null) {
        return $env;
    }

    $env = [];
    $envPath = __DIR__ . '/../.env';

    if (!file_exists($envPath)) {
        return $env;
    }

    $lines = file($envPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    if ($lines === false) {
        return $env;
    }

    foreach ($lines as $line) {
        $line = trim($line);
        if ($line === '' || strpos($line, '#') === 0) {
            continue;
        }

        $parts = explode('=', $line, 2);
        if (count($parts) !== 2) {
            continue;
        }

        $key = trim($parts[0]);
        $value = trim($parts[1]);
        $value = trim($value, "\"'");

        if ($key !== '') {
            $env[$key] = $value;
        }
    }

    return $env;
}

/**
 * Read environment variables from process env first, then local .env.
 */
function riceguardEnv($keys, $default = '') {
    foreach ((array)$keys as $key) {
        $runtimeValue = getenv($key);
        if ($runtimeValue !== false && $runtimeValue !== '') {
            return $runtimeValue;
        }

        $envMap = riceguardLoadEnvMap();
        if (isset($envMap[$key]) && $envMap[$key] !== '') {
            return $envMap[$key];
        }
    }

    return $default;
}

/**
 * Resolve provider configuration.
 */
function riceguardNormalizeAiProvider($provider) {
    $provider = strtolower(trim((string)$provider));

    if ($provider === 'ollama' || $provider === 'ollama-cloud') {
        return RICEGUARD_AI_PROVIDER_OLLAMA;
    }

    if ($provider === 'nvidia' || $provider === 'nim' || $provider === 'nvidia-nim' || $provider === '') {
        return RICEGUARD_AI_PROVIDER_NVIDIA;
    }

    return RICEGUARD_AI_DEFAULT_PROVIDER;
}

/**
 * Join a base URL and path safely.
 */
function riceguardJoinUrl($baseUrl, $path) {
    return rtrim((string)$baseUrl, '/') . '/' . ltrim((string)$path, '/');
}

/**
 * Normalize the Ollama base URL to its native API root.
 */
function riceguardNormalizeOllamaBaseUrl($baseUrl) {
    $baseUrl = rtrim(trim((string)$baseUrl), '/');
    if ($baseUrl === '') {
        $baseUrl = RICEGUARD_AI_OLLAMA_DEFAULT_BASE_URL;
    }

    if (preg_match('#/v1$#i', $baseUrl)) {
        $baseUrl = preg_replace('#/v1$#i', '/api', $baseUrl);
    }

    if (!preg_match('#/api$#i', $baseUrl)) {
        $baseUrl .= '/api';
    }

    return $baseUrl;
}

/**
 * Detect whether the configured endpoint requires a bearer API key.
 */
function riceguardRequiresApiKey(array $config) {
    if (($config['transport'] ?? '') === 'ollama-chat') {
        return stripos((string)($config['base_url'] ?? ''), 'https://ollama.com/api') === 0;
    }

    return true;
}

function riceguardGetAiConfig() {
    $provider = riceguardNormalizeAiProvider(
        riceguardEnv(['RICEGUARD_AI_PROVIDER', 'AI_PROVIDER'], RICEGUARD_AI_DEFAULT_PROVIDER)
    );

    if ($provider === RICEGUARD_AI_PROVIDER_OLLAMA) {
        $baseUrl = riceguardNormalizeOllamaBaseUrl(
            riceguardEnv(
                ['OLLAMA_BASE_URL', 'OLLAMA_API_BASE_URL', 'RICEGUARD_AI_BASE_URL'],
                RICEGUARD_AI_OLLAMA_DEFAULT_BASE_URL
            )
        );

        return [
            'provider' => $provider,
            'transport' => 'ollama-chat',
            'base_url' => $baseUrl,
            'chat_url' => riceguardJoinUrl($baseUrl, 'chat'),
            'api_key' => riceguardEnv(['OLLAMA_API_KEY', 'RICEGUARD_AI_API_KEY'], ''),
            'model' => riceguardEnv(['OLLAMA_MODEL', 'RICEGUARD_AI_MODEL'], RICEGUARD_AI_OLLAMA_DEFAULT_MODEL),
        ];
    }

    $baseUrl = rtrim(
        riceguardEnv(['NVIDIA_BASE_URL', 'NVIDIA_API_BASE_URL', 'RICEGUARD_AI_BASE_URL'], RICEGUARD_AI_DEFAULT_BASE_URL),
        '/'
    );

    return [
        'provider' => $provider,
        'transport' => 'openai-chat-completions',
        'base_url' => $baseUrl,
        'chat_url' => riceguardJoinUrl($baseUrl, 'chat/completions'),
        'api_key' => riceguardEnv(['NVIDIA_API_KEY', 'NVIDIA_NIM_API_KEY', 'RICEGUARD_AI_API_KEY'], ''),
        'model' => riceguardEnv(['NVIDIA_MODEL', 'RICEGUARD_AI_MODEL'], RICEGUARD_AI_DEFAULT_MODEL),
    ];
}

/**
 * Normalize disease names to the app's supported canonical labels.
 */
function riceguardNormalizeDisease($disease) {
    $value = trim((string)$disease);
    $lower = strtolower($value);

    if ($lower === '') {
        return 'Unknown';
    }

    if (strpos($lower, 'blast') !== false) {
        return 'Rice Blast';
    }

    if (strpos($lower, 'bacterial leaf blight') !== false || strpos($lower, 'blb') !== false || strpos($lower, 'leaf blight') !== false) {
        return 'Bacterial Leaf Blight';
    }

    if (strpos($lower, 'tungro') !== false) {
        return 'Tungro';
    }

    return $value;
}

/**
 * Current Philippine seasonal context.
 */
function riceguardGetSeasonContext() {
    $month = (int)date('n');
    $isWetSeason = $month >= 6 && $month <= 11;

    return [
        'season_key' => $isWetSeason ? 'wet' : 'dry',
        'season_label' => $isWetSeason ? 'wet season (June-November)' : 'dry season (December-May)',
        'season_note' => $isWetSeason
            ? 'Mas mataas ang pressure ng sakit sa tuloy-tuloy na ulan, hamog, at mataas na humidity.'
            : 'Mas mahalaga ang bantay sa water stress, vector movement, at maagang pag-isolate ng apektadong bahagi.',
    ];
}

/**
 * Provide compact disease facts for prompt grounding.
 */
function riceguardGetDiseaseReference($canonicalDisease) {
    switch ($canonicalDisease) {
        case 'Rice Blast':
            return "Rice Blast: fungal disease ito na lumalala sa basang dahon, mataas na nitrogen, at masikip na tanim. Bantayan ang leaf blast, neck blast, at mabilis na pagdami ng lesions.";

        case 'Bacterial Leaf Blight':
            return "Bacterial Leaf Blight: bacterial disease ito na nauugnay sa sugat, malakas na ulan/hangin, at sobrang nitrogen. Tutukan ang water-soaked hanggang naninilaw at natutuyong dahon.";

        case 'Tungro':
            return "Tungro: viral disease ito na ipinapasa ng green leafhopper. Unahin ang rogueing, vector control, synchronized planting, at pag-iwas sa late planting.";

        default:
            return "General rice disease management: unahin ang tamang diagnosis, field isolation, sanitation, water management, at mabilis na konsultasyon sa agriculturist kung lumalala.";
    }
}

/**
 * Recommended follow-up questions for future chat-style UX.
 */
function riceguardSuggestedFollowUps($canonicalDisease) {
    switch ($canonicalDisease) {
        case 'Rice Blast':
            return [
                'May neck blast na ba o nasa dahon pa lang ang lesions?',
                'Mataas ba ang nailagay na nitrogen nitong huling abono?',
                'May palaging basa o hamog ba sa apektadong bahagi ng bukid?',
            ];

        case 'Bacterial Leaf Blight':
            return [
                'Kailan nagsimula ang paninilaw at pagkatuyo ng dahon?',
                'Malakas ba ang ulan o hangin bago lumabas ang sintomas?',
                'May problema ba sa drainage o sobrang nitrogen sa bukid?',
            ];

        case 'Tungro':
            return [
                'Marami ka bang nakikitang green leafhopper sa palayan?',
                'Pantay ba ang taniman sa paligid o may late-planted fields?',
                'Ilang porsyento ng halaman ang may paninilaw o stunting?',
            ];

        default:
            return [
                'Ano ang eksaktong sintomas na nakikita sa dahon o tangkay?',
                'Gaano kalawak ang apektadong bahagi ng bukid?',
                'Kailan unang napansin ang sintomas at ano ang lagay ng panahon noon?',
            ];
    }
}

/**
 * Attach live weather context when available.
 */
function riceguardBuildWeatherContextText(array $context) {
    if (empty($context['weather_snapshot']['success'])) {
        return '';
    }

    return riceguardBuildWeatherPromptContext($context['weather_snapshot']);
}

/**
 * Detect whether the admin prompt is asking for a weather-focused update.
 */
function riceguardIsWeatherUpdateRequest($prompt) {
    $prompt = strtolower(trim((string)$prompt));
    if ($prompt === '') {
        return false;
    }

    $needles = [
        'weather',
        'panahon',
        'weather update',
        'update sa panahon',
        'ulan',
        'forecast',
        'bagyo',
        'halumigmig',
    ];

    foreach ($needles as $needle) {
        if (strpos($prompt, $needle) !== false) {
            return true;
        }
    }

    return false;
}

/**
 * Build the system prompt for the selected mode.
 */
function riceguardBuildSystemPrompt($mode, array $context) {
    $season = $context['season']['season_label'] ?? 'current season';
    $seasonNote = $context['season']['season_note'] ?? '';
    $diseaseReference = riceguardGetDiseaseReference($context['recognized_disease'] ?? 'Unknown');
    $weatherContext = riceguardBuildWeatherContextText($context);
    $regionalKnowledge = riceguardGetRegionalKnowledge();

    $modeInstructions = $mode === 'sms_draft'
        ? "OUTPUT FORMAT:\n- Gumawa ng 2 o 3 maikling pangungusap o maiikling linya lang.\n- Dapat bagay sa admin SMS blast o public advisory draft.\n- Huwag maglagay ng heading o closing signature.\n- Hangga't maaari, panatilihin sa loob ng humigit-kumulang 280 characters nang hindi isinasakripisyo ang linaw.\n- Banggitin lang ang pinakamahalagang aksyon at isang malinaw na paalala."
        : "OUTPUT FORMAT:\n- Unang character ng sagot ay dapat 1.\n- Sumagot sa 4 o 5 numbered steps lamang.\n- Bawat step ay dapat isang maikling konkretong utos o gawain.\n- Isama ang immediate action, treatment direction, safety precaution, at kailan dapat mag-escalate sa agriculturist.\n- Huwag maglagay ng intro line, heading, o closing sentence.";

    return "Ikaw si RiceGuard AI Field Agent, isang advanced rice disease expert para sa palay sa Pilipinas.\n\n"
        . "MISSION:\n"
        . "- Unawain muna ang kaso: sakit, severity, season, lokasyon, at hinihinging output.\n"
        . "- Mag-isip muna nang tahimik at ilabas lamang ang final answer.\n"
        . "- Kung sapat ang datos, magbigay agad ng malinaw at actionable na sagot.\n"
        . "- Kung kulang ang datos at diagnosis ang tanong, magtanong lang ng pinakamaikling 1 o 2 follow-up questions.\n"
        . "- Gumamit ng natural na Tagalog o Taglish na madaling maintindihan ng magsasaka.\n"
        . "- Huwag gumamit ng emoji.\n"
        . "- Huwag mag-imbento ng dosage o label rate; kung hindi tiyak, banggitin ang active ingredient o uri ng treatment at sabihing sundin ang product label at local agriculturist.\n"
        . "- Kapag gabi o madaling araw batay sa live weather time, huwag mag-utos ng pag-spray o pag-ikot sa bukid na parang kasalukuyan itong gagawin; sabihin nang malinaw na ipagpaliban muna hanggang may liwanag at ligtas ang kondisyon.\n"
        . "- Kapag weather update ang hiling, banggitin ang kasalukuyang oras/panahon, ang posibleng dahilan ng risk, ang bawal o hindi muna dapat gawin ngayon, at isang maikling paalalang mag-ingat.\n"
        . "- Huwag lumihis sa rice disease at rice field management scope.\n"
        . "- Kapag wala sa scope ang tanong, sabihin lang ito nang eksakto: Sorry, I can't help you with that. As a Rice Expert, I can only help you with diagnosing and managing rice diseases.\n\n"
        . "DOMAIN CONTEXT:\n"
        . "- Priority diseases mo: Rice Blast, Bacterial Leaf Blight (BLB), at Tungro.\n"
        . "- Seasonal context: {$season}.\n"
        . "- Seasonal note: {$seasonNote}\n"
        . "- Disease reference: {$diseaseReference}\n"
        . "\n{$regionalKnowledge}\n"
        . ($weatherContext !== '' ? "\n{$weatherContext}\n" : "\n")
        . $modeInstructions;
}

/**
 * Convert request context to a compact user message.
 */
function riceguardBuildTaskPrompt(array $context, $mode) {
    $locationBits = [];

    if (!empty($context['location_text'])) {
        $locationBits[] = "Lokasyon: " . $context['location_text'];
    }

    if ($context['latitude'] !== null && $context['longitude'] !== null && $context['latitude'] !== '' && $context['longitude'] !== '') {
        $locationBits[] = "Coordinates: {$context['latitude']}, {$context['longitude']}";
    }

    $locationLine = empty($locationBits) ? "Lokasyon: Hindi tinukoy" : implode(' | ', $locationBits);
    $severity = trim((string)($context['severity'] ?? 'High')) ?: 'High';
    $weatherContext = riceguardBuildWeatherContextText($context);

    if ($mode === 'sms_draft') {
        $task = trim((string)($context['prompt'] ?? ''));
        $isWeatherUpdate = riceguardIsWeatherUpdateRequest($task);

        $prompt = "Task: Gumawa ng maikling advisory draft para sa admin.\n"
            . "Audience: Rice farmers sa Pilipinas.\n"
            . $locationLine . "\n"
            . "Admin request: {$task}";

        if ($isWeatherUpdate) {
            $prompt .= "\nRequired focus for this weather update:"
                . "\n1. Sabihin ang kasalukuyang oras o time-of-day context."
                . "\n2. Kung madaling araw o gabi, sabihin nang direkta na huwag munang mag-spray ngayon."
                . "\n3. Banggitin ang posibleng sanhi ng risk batay sa halumigmig, hamog, ulap, o paparating na ulan."
                . "\n4. Magbigay ng maikling paalala kung kailan mas tamang kumilos."
                . "\n5. Tapusin sa maikling linyang nagbababala o nagsasabing mag-ingat.";
        }

        if ($weatherContext !== '') {
            $prompt .= "\n\nGamitin ito bilang live weather basis:\n{$weatherContext}";
        }

        return $prompt;
    }

    $canonicalDisease = $context['recognized_disease'] ?? 'Unknown';
    $originalDisease = trim((string)($context['disease'] ?? $canonicalDisease));
    $adminInstruction = trim((string)($context['admin_prompt'] ?? ''));

    $prompt = "Task: Magbigay ng agarang field advice para sa magsasaka.\n"
        . "Detected disease: {$canonicalDisease}\n"
        . "Original disease label: {$originalDisease}\n"
        . "Severity: {$severity}\n"
        . $locationLine . "\n"
        . "Goal: Sabihin kung ano ang dapat gawin agad sa susunod na 24-72 oras para hindi lumala.\n"
        . "Format reminder: 4 o 5 numbered steps lang, walang intro o outro.";

    if ($adminInstruction !== '') {
        $prompt .= "\nDagdag na context mula sa agriculturist/admin: {$adminInstruction}";
    }

    if ($weatherContext !== '') {
        $prompt .= "\n\nGamitin ang sumusunod na live weather context sa pag-prioritize ng actions:\n{$weatherContext}";
    }

    return $prompt;
}

/**
 * Keep only supported chat message roles and content.
 */
function riceguardSanitizeMessages($messages) {
    $clean = [];

    if (!is_array($messages)) {
        return $clean;
    }

    foreach ($messages as $message) {
        if (!is_array($message)) {
            continue;
        }

        $role = $message['role'] ?? '';
        $content = $message['content'] ?? '';

        if (!in_array($role, ['user', 'assistant'], true)) {
            continue;
        }

        if (!is_string($content) || trim($content) === '') {
            continue;
        }

        $clean[] = [
            'role' => $role,
            'content' => trim($content),
        ];
    }

    return $clean;
}

/**
 * Extract assistant text from a chat completion response.
 */
function riceguardExtractContentText($content) {
    if (is_string($content)) {
        return trim($content);
    }

    if (!is_array($content)) {
        return '';
    }

    $parts = [];
    foreach ($content as $chunk) {
        if (is_string($chunk)) {
            $parts[] = $chunk;
            continue;
        }

        if (is_array($chunk) && ($chunk['type'] ?? '') === 'text' && isset($chunk['text'])) {
            $parts[] = $chunk['text'];
        }
    }

    return trim(implode('', $parts));
}

/**
 * Extract assistant text from either OpenAI-compatible or native Ollama responses.
 */
function riceguardExtractAssistantText(array $response) {
    if (isset($response['message']) && is_array($response['message'])) {
        return riceguardExtractContentText($response['message']['content'] ?? '');
    }

    return riceguardExtractContentText($response['choices'][0]['message']['content'] ?? '');
}

/**
 * Build a provider-specific chat payload.
 */
function riceguardBuildModelPayload(array $config, array $messages, $systemPrompt, $mode, $attemptReasoning) {
    $temperature = $mode === 'sms_draft' ? 0.3 : 0.2;
    $topP = 0.95;
    $maxTokens = $mode === 'sms_draft' ? 320 : 520;
    $requestMessages = array_merge(
        [['role' => 'system', 'content' => $systemPrompt]],
        $messages
    );

    if (($config['transport'] ?? '') === 'ollama-chat') {
        $payload = [
            'model' => $config['model'],
            'messages' => $requestMessages,
            'stream' => false,
            'options' => [
                'temperature' => $temperature,
                'top_p' => $topP,
                'num_predict' => $maxTokens,
            ],
        ];

        if ($attemptReasoning === 'none') {
            $payload['think'] = false;
        }

        return $payload;
    }

    return [
        'model' => $config['model'],
        'messages' => $requestMessages,
        'temperature' => $temperature,
        'top_p' => $topP,
        'max_tokens' => $maxTokens,
        'reasoning_effort' => $attemptReasoning,
        'stream' => false,
    ];
}

/**
 * Execute a single provider request.
 */
function riceguardRunModelRequest(array $config, array $payload) {
    $headers = ['Content-Type: application/json'];
    if (($config['api_key'] ?? '') !== '') {
        $headers[] = 'Authorization: Bearer ' . $config['api_key'];
    }

    $ch = curl_init($config['chat_url']);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode($payload),
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_CONNECTTIMEOUT => 15,
        CURLOPT_TIMEOUT => 180,
        CURLOPT_HTTP_VERSION => CURL_HTTP_VERSION_1_1,
        CURLOPT_IPRESOLVE => CURL_IPRESOLVE_V4,
        CURLOPT_SSLVERSION => CURL_SSLVERSION_TLSv1_2,
        CURLOPT_SSL_VERIFYPEER => true,
    ]);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);

    $decoded = is_string($response) ? json_decode($response, true) : null;
    $assistantText = is_array($decoded) ? riceguardExtractAssistantText($decoded) : '';

    return [
        'assistant_text' => $assistantText,
        'decoded' => $decoded,
        'http_code' => $httpCode,
        'curl_error' => $curlError,
    ];
}

/**
 * Weather-aware fallback for short updates.
 */
function riceguardBuildWeatherUpdateFallback(array $context) {
    $snapshot = $context['weather_snapshot'] ?? null;
    if (!is_array($snapshot) || empty($snapshot['success'])) {
        return "Mag-ingat sa pabago-bagong panahon at bantayan ang halumigmig sa palayan. Iwasan muna ang pag-spray kung madilim pa o may nakaambang ulan, at kumilos na lang kapag may liwanag at mas ligtas ang kondisyon.";
    }

    $current = $snapshot['current'] ?? [];
    $forecast = $snapshot['forecast'] ?? [];
    $agriculture = $snapshot['agriculture'] ?? [];
    $timeLabel = $current['observed_clock'] ?? ($current['observed_at'] ?? 'ngayon');
    $timePhase = $current['time_phase'] ?? 'kasalukuyang oras';
    $causes = !empty($agriculture['probable_causes'])
        ? implode(', ', array_slice($agriculture['probable_causes'], 0, 2))
        : 'mataas na moisture sa paligid';

    if (!empty($current['is_night'])) {
        return "Ngayong {$timePhase}, {$timeLabel} pa lang, huwag munang mag-spray dahil madilim at maaaring basa pa ang dahon. Mag-ingat dahil ang risk ngayon ay puwedeng dulot ng {$causes}; mas mabuting mag-check at magdesisyon pag may liwanag na.";
    }

    return "Ngayong {$timePhase}, mag-ingat dahil ang risk sa palayan ay puwedeng dulot ng {$causes}. Kung may ulan na {$forecast['highest_pop_pct']}% ang tsansa, iwasan muna ang pag-spray at maghintay ng mas maayos na timing bago kumilos.";
}

/**
 * Fallback advice when the remote model is unavailable.
 */
function riceguardBuildFallbackText(array $context, $mode) {
    $canonicalDisease = $context['recognized_disease'] ?? 'Unknown';
    $severity = trim((string)($context['severity'] ?? 'High')) ?: 'High';

    if ($mode === 'sms_draft') {
        if (riceguardIsWeatherUpdateRequest($context['prompt'] ?? '')) {
            return riceguardBuildWeatherUpdateFallback($context);
        }

        switch ($canonicalDisease) {
            case 'Rice Blast':
                return "Magandang araw. May mataas na banta ng Rice Blast sa palayan, kaya iwasan ang sobrang nitrogen, bantayan ang basang dahon, at kumonsulta agad sa agriculturist kung lumalawak ang lesions.";

            case 'Bacterial Leaf Blight':
                return "Magandang araw. May banta ng Bacterial Leaf Blight, kaya ayusin ang drainage, iwasan ang sobrang nitrogen, at i-report agad kung mabilis ang pagkatuyo ng mga dahon.";

            case 'Tungro':
                return "Magandang araw. May banta ng Tungro, kaya bunutin ang apektadong halaman, bantayan ang green leafhopper, at makipag-ugnayan agad sa agriculturist para sa vector control.";

            default:
                $prompt = trim((string)($context['prompt'] ?? ''));
                return "Magandang araw. {$prompt} Paki-monitor nang mabuti ang palayan at kumonsulta agad sa agriculturist kung may sintomas ng rice disease.";
        }
    }

    switch ($canonicalDisease) {
        case 'Rice Blast':
            return "1. Ihiwalay at markahan agad ang apektadong bahagi ng palayan para ma-monitor kung lumalawak ang lesions.\n"
                . "2. Bawasan muna ang sobrang nitrogen at panatilihing maayos ang water management para hindi manatiling basang-basa ang dahon.\n"
                . "3. Kung {$severity} ang tama, gumamit lamang ng aprubadong fungicide laban sa blast ayon sa product label at payo ng agriculturist.\n"
                . "4. Magsuot ng kumpletong PPE sa pag-spray at huwag maghalo ng kemikal nang walang label guide.\n"
                . "5. Kung may neck blast na o mabilis ang pagdami sa heading stage, ipaalam agad sa Municipal Agriculturist.";

        case 'Bacterial Leaf Blight':
            return "1. Ayusin agad ang drainage at iwasan ang sobrang nitrogen para hindi mas lalong lumala ang BLB.\n"
                . "2. Bawasan ang paggalaw sa basang bahagi ng bukid para hindi kumalat ang impeksiyon.\n"
                . "3. Linisin ang paligid at obserbahan ang lawak ng paninilaw sa susunod na 3 hanggang 5 araw.\n"
                . "4. Kung gagamit ng treatment, sundin lamang ang rehistradong produkto at label directions sa inyong lugar.\n"
                . "5. Kapag mabilis ang pagkatuyo ng dahon o malawak na ang tama, tumawag agad sa agriculturist para sa site visit.";

        case 'Tungro':
            return "1. Bunutin agad ang matinding apektadong halaman at ilayo sa malusog na tanim para mabawasan ang pinagmumulan ng virus.\n"
                . "2. Mag-monitor agad ng green leafhopper at gumamit lang ng aprubadong insect control ayon sa product label kung mataas ang vector pressure.\n"
                . "3. Iwasan ang late planting at kausapin ang kalapit-bukid para mas sabay ang taniman.\n"
                . "4. Magsuot ng PPE kung may chemical application at huwag mag-spray kapag malakas ang hangin o uulan.\n"
                . "5. Kung mabilis ang stunting at paninilaw sa maraming halaman, magpa-assess agad sa Municipal Agriculturist.";

        default:
            return "1. I-obserbahan at i-document agad ang sintomas sa apektadong bahagi ng bukid.\n"
                . "2. Ihiwalay kung saan posible ang apektadong area para hindi agad kumalat ang problema.\n"
                . "3. Iwasan muna ang padalos-dalos na paglalagay ng kemikal kung hindi pa tiyak ang diagnosis.\n"
                . "4. Panatilihing maayos ang tubig, sanitation, at field monitoring sa susunod na mga araw.\n"
                . "5. Kumonsulta agad sa lokal na agriculturist para sa tamang diagnosis at treatment plan.";
    }
}

/**
 * Main entry point for RiceGuard AI generation.
 */
function riceguardGenerateRiceExpertResponse(array $params) {
    $mode = $params['mode'] ?? 'field_advisory';
    if (!in_array($mode, ['field_advisory', 'sms_draft'], true)) {
        $mode = 'field_advisory';
    }

    $reasoningEffort = $params['reasoning_effort'] ?? 'high';
    if (!in_array($reasoningEffort, ['none', 'high', 'max'], true)) {
        $reasoningEffort = 'high';
    }

    $season = riceguardGetSeasonContext();
    $recognizedDisease = riceguardNormalizeDisease($params['disease'] ?? '');

    $context = [
        'prompt' => trim((string)($params['prompt'] ?? '')),
        'disease' => trim((string)($params['disease'] ?? '')),
        'recognized_disease' => $recognizedDisease,
        'severity' => trim((string)($params['severity'] ?? 'High')),
        'admin_prompt' => trim((string)($params['admin_prompt'] ?? '')),
        'location_text' => trim((string)($params['location_text'] ?? '')),
        'latitude' => $params['latitude'] ?? null,
        'longitude' => $params['longitude'] ?? null,
        'season' => $season,
    ];

    $weatherSnapshot = riceguardGetWeatherSnapshot([
        'location_text' => $context['location_text'],
        'latitude' => $context['latitude'],
        'longitude' => $context['longitude'],
    ]);
    if (!empty($weatherSnapshot['success'])) {
        $context['weather_snapshot'] = $weatherSnapshot;
    } elseif (!empty($weatherSnapshot['error'])) {
        $context['weather_warning'] = $weatherSnapshot['error'];
    }

    $systemPrompt = riceguardBuildSystemPrompt($mode, $context);
    $messages = riceguardSanitizeMessages($params['messages'] ?? []);

    if (empty($messages)) {
        $messages = [
            [
                'role' => 'user',
                'content' => riceguardBuildTaskPrompt($context, $mode),
            ],
        ];
    }

    $config = riceguardGetAiConfig();
    if (riceguardRequiresApiKey($config) && $config['api_key'] === '') {
        return [
            'success' => true,
            'content' => riceguardBuildFallbackText($context, $mode),
            'is_fallback' => true,
            'provider' => $config['provider'],
            'model' => $config['model'],
            'reasoning_effort' => $reasoningEffort,
            'recognized_disease' => $recognizedDisease,
            'suggested_follow_ups' => riceguardSuggestedFollowUps($recognizedDisease),
            'warning' => 'AI provider API key is not configured.',
            'weather' => $context['weather_snapshot'] ?? null,
            'weather_warning' => $context['weather_warning'] ?? null,
        ];
    }

    $attempts = [$reasoningEffort];
    if ($reasoningEffort !== 'none') {
        $attempts[] = 'none';
    }

    $assistantText = '';
    $decoded = null;
    $httpCode = 0;
    $curlError = '';
    $usedReasoningEffort = $reasoningEffort;
    $requestWarning = null;

    foreach (array_values(array_unique($attempts)) as $attemptReasoning) {
        $payload = riceguardBuildModelPayload($config, $messages, $systemPrompt, $mode, $attemptReasoning);

        $run = riceguardRunModelRequest($config, $payload);
        $assistantText = $run['assistant_text'] ?? '';
        $decoded = $run['decoded'] ?? null;
        $httpCode = $run['http_code'] ?? 0;
        $curlError = $run['curl_error'] ?? '';

        if ($curlError === '' && $httpCode === 200 && $assistantText !== '') {
            $usedReasoningEffort = $attemptReasoning;
            if ($attemptReasoning !== $reasoningEffort) {
                $requestWarning = "Initial {$reasoningEffort} reasoning attempt failed; auto-retried with {$attemptReasoning}.";
            }
            break;
        }
    }

    if ($curlError || $httpCode !== 200 || $assistantText === '') {
        $warning = $curlError !== ''
            ? $curlError
            : 'The configured AI provider returned an invalid response.';

        return [
            'success' => true,
            'content' => riceguardBuildFallbackText($context, $mode),
            'is_fallback' => true,
            'provider' => $config['provider'],
            'model' => $config['model'],
            'reasoning_effort' => $usedReasoningEffort,
            'requested_reasoning_effort' => $reasoningEffort,
            'recognized_disease' => $recognizedDisease,
            'suggested_follow_ups' => riceguardSuggestedFollowUps($recognizedDisease),
            'warning' => $warning,
            'http_code' => $httpCode,
            'weather' => $context['weather_snapshot'] ?? null,
            'weather_warning' => $context['weather_warning'] ?? null,
        ];
    }

    return [
        'success' => true,
        'content' => $assistantText,
        'is_fallback' => false,
        'provider' => $config['provider'],
        'model' => $config['model'],
        'reasoning_effort' => $usedReasoningEffort,
        'requested_reasoning_effort' => $reasoningEffort,
        'recognized_disease' => $recognizedDisease,
        'suggested_follow_ups' => riceguardSuggestedFollowUps($recognizedDisease),
        'warning' => $requestWarning,
        'weather' => $context['weather_snapshot'] ?? null,
        'weather_warning' => $context['weather_warning'] ?? null,
        'raw_response' => $decoded,
    ];
}
?>
