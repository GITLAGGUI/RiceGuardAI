<?php
/**
 * RiceGuard Weather Helper
 *
 * Shared OpenWeather integration for dashboard widgets and AI context.
 */

define('RICEGUARD_WEATHER_DEFAULT_BASE_URL', 'https://api.openweathermap.org');
define('RICEGUARD_WEATHER_DEFAULT_CACHE_TTL', 600);

/**
 * Read .env and runtime env values for weather configuration.
 */
function riceguardWeatherEnv($keys, $default = '') {
    static $envMap = null;

    if ($envMap === null) {
        $envMap = [];
        $envPath = __DIR__ . '/../.env';

        if (file_exists($envPath)) {
            $lines = file($envPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
            if (is_array($lines)) {
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
                    $envMap[$key] = trim($value, "\"'");
                }
            }
        }
    }

    foreach ((array)$keys as $key) {
        $runtimeValue = getenv($key);
        if ($runtimeValue !== false && $runtimeValue !== '') {
            return $runtimeValue;
        }

        if (isset($envMap[$key]) && $envMap[$key] !== '') {
            return $envMap[$key];
        }
    }

    return $default;
}

/**
 * Weather service configuration.
 */
function riceguardGetWeatherConfig() {
    return [
        'base_url' => rtrim(riceguardWeatherEnv(['OPENWEATHER_BASE_URL'], RICEGUARD_WEATHER_DEFAULT_BASE_URL), '/'),
        'api_key' => riceguardWeatherEnv(['OPENWEATHER_API_KEY', 'WEATHER_API_KEY'], ''),
        'cache_ttl' => (int)riceguardWeatherEnv(['OPENWEATHER_CACHE_TTL'], (string)RICEGUARD_WEATHER_DEFAULT_CACHE_TTL),
    ];
}

/**
 * Generic GET JSON helper for weather calls.
 */
function riceguardWeatherJsonGet($url, $timeoutSeconds = 20) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_TIMEOUT => $timeoutSeconds,
        CURLOPT_HTTP_VERSION => CURL_HTTP_VERSION_1_1,
        CURLOPT_IPRESOLVE => CURL_IPRESOLVE_V4,
        CURLOPT_SSLVERSION => CURL_SSLVERSION_TLSv1_2,
        CURLOPT_SSL_VERIFYPEER => true,
    ]);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);

    if ($curlError !== '') {
        return ['success' => false, 'error' => $curlError, 'http_code' => $httpCode];
    }

    $decoded = is_string($response) ? json_decode($response, true) : null;
    if ($httpCode !== 200 || !is_array($decoded)) {
        $message = is_array($decoded) && !empty($decoded['message'])
            ? (string)$decoded['message']
            : 'Weather API returned invalid data.';
        return [
            'success' => false,
            'error' => $message,
            'http_code' => $httpCode,
            'raw' => $response,
        ];
    }

    return ['success' => true, 'data' => $decoded, 'http_code' => $httpCode];
}

/**
 * Ensure cache directory exists.
 */
function riceguardWeatherCacheDir() {
    $dir = __DIR__ . '/cache';
    if (!is_dir($dir)) {
        @mkdir($dir, 0777, true);
    }
    return $dir;
}

/**
 * Cache read helper.
 */
function riceguardWeatherReadCache($cacheKey, $ttlSeconds) {
    $path = riceguardWeatherCacheDir() . '/' . $cacheKey . '.json';
    if (!file_exists($path)) {
        return null;
    }

    $contents = file_get_contents($path);
    if ($contents === false) {
        return null;
    }

    $decoded = json_decode($contents, true);
    if (!is_array($decoded) || !isset($decoded['stored_at'], $decoded['payload'])) {
        return null;
    }

    if ((time() - (int)$decoded['stored_at']) > $ttlSeconds) {
        return null;
    }

    return $decoded['payload'];
}

/**
 * Cache write helper.
 */
function riceguardWeatherWriteCache($cacheKey, array $payload) {
    $path = riceguardWeatherCacheDir() . '/' . $cacheKey . '.json';
    $wrapper = json_encode([
        'stored_at' => time(),
        'payload' => $payload,
    ]);

    if ($wrapper !== false) {
        @file_put_contents($path, $wrapper, LOCK_EX);
    }
}

/**
 * Normalize numeric coordinate input.
 */
function riceguardWeatherNormalizeCoordinate($value) {
    if ($value === null || $value === '') {
        return null;
    }

    if (!is_numeric($value)) {
        return null;
    }

    return (float)$value;
}

/**
 * Build location search candidates from farmer/location text.
 */
function riceguardBuildLocationCandidates(array $options) {
    $candidates = [];
    $locationText = trim((string)($options['location_text'] ?? ''));

    if ($locationText !== '') {
        $candidates[] = $locationText;
        $candidates[] = str_replace('Brgy. ', '', $locationText);
    }

    $farmer = $options['farmer'] ?? [];
    if (is_array($farmer)) {
        $parts = array_values(array_filter([
            trim((string)($farmer['barangay'] ?? '')),
            trim((string)($farmer['municipality'] ?? '')),
            trim((string)($farmer['province'] ?? '')),
            'Philippines',
        ]));

        if (!empty($parts)) {
            $candidates[] = implode(', ', $parts);
        }

        $municipalityProvince = array_values(array_filter([
            trim((string)($farmer['municipality'] ?? '')),
            trim((string)($farmer['province'] ?? '')),
            'Philippines',
        ]));
        if (!empty($municipalityProvince)) {
            $candidates[] = implode(', ', $municipalityProvince);
        }

        $provinceOnly = trim((string)($farmer['province'] ?? ''));
        if ($provinceOnly !== '') {
            $candidates[] = $provinceOnly . ', Philippines';
        }
    }

    return array_values(array_unique(array_filter(array_map('trim', $candidates))));
}

/**
 * Try geocoding a free-text location via OpenWeather.
 */
function riceguardWeatherGeocode(array $options) {
    $config = riceguardGetWeatherConfig();
    if ($config['api_key'] === '') {
        return null;
    }

    foreach (riceguardBuildLocationCandidates($options) as $candidate) {
        $url = $config['base_url']
            . '/geo/1.0/direct?q=' . rawurlencode($candidate)
            . '&limit=1&appid=' . rawurlencode($config['api_key']);

        $result = riceguardWeatherJsonGet($url, 20);
        if (!$result['success'] || empty($result['data'][0])) {
            continue;
        }

        $first = $result['data'][0];
        if (!isset($first['lat'], $first['lon'])) {
            continue;
        }

        $resolvedLabelParts = array_filter([
            $first['name'] ?? '',
            $first['state'] ?? '',
            $first['country'] ?? '',
        ]);

        return [
            'latitude' => (float)$first['lat'],
            'longitude' => (float)$first['lon'],
            'label' => implode(', ', $resolvedLabelParts) ?: $candidate,
            'source' => 'geocoded',
        ];
    }

    return null;
}

/**
 * Resolve usable weather coordinates.
 */
function riceguardResolveWeatherLocation(array $options) {
    $lat = riceguardWeatherNormalizeCoordinate($options['latitude'] ?? null);
    $lon = riceguardWeatherNormalizeCoordinate($options['longitude'] ?? null);
    $locationText = trim((string)($options['location_text'] ?? ''));

    if ($lat !== null && $lon !== null) {
        return [
            'latitude' => $lat,
            'longitude' => $lon,
            'label' => $locationText !== '' ? $locationText : 'Detected field location',
            'source' => 'provided_coords',
        ];
    }

    $farmerId = isset($options['farmer_id']) && is_numeric($options['farmer_id'])
        ? (int)$options['farmer_id']
        : null;

    if ($farmerId && function_exists('getDB')) {
        try {
            $db = getDB();
            $stmt = $db->prepare("
                SELECT latitude, longitude, disease, created_at
                FROM disease_detections
                WHERE farmer_id = ? AND latitude IS NOT NULL AND longitude IS NOT NULL
                ORDER BY created_at DESC
                LIMIT 1
            ");
            $stmt->execute([$farmerId]);
            $latestDetection = $stmt->fetch();

            if ($latestDetection) {
                return [
                    'latitude' => (float)$latestDetection['latitude'],
                    'longitude' => (float)$latestDetection['longitude'],
                    'label' => $locationText !== '' ? $locationText : 'Latest scanned field location',
                    'source' => 'latest_detection',
                ];
            }
        } catch (Throwable $ignored) {
            // Fallback to geocoding below.
        }
    }

    return riceguardWeatherGeocode($options);
}

/**
 * Format a local timestamp using timezone offset from OpenWeather.
 */
function riceguardWeatherFormatLocalTime($unixTime, $timezoneOffset, $format = 'M j, g:i A') {
    if (!$unixTime) {
        return null;
    }
    return gmdate($format, ((int)$unixTime) + ((int)$timezoneOffset));
}

/**
 * Build agriculture-focused weather insights.
 */
function riceguardBuildWeatherAgronomy(array $current, array $forecastSummary) {
    $humidity = (int)($current['humidity_pct'] ?? 0);
    $windKph = (float)($current['wind_kph'] ?? 0);
    $rainNext12h = (float)($forecastSummary['rain_volume_12h_mm'] ?? 0);
    $highestPop = (int)($forecastSummary['highest_pop_pct'] ?? 0);
    $condition = strtolower((string)($current['condition'] ?? ''));
    $description = strtolower((string)($current['description'] ?? ''));

    $riskScore = 0;
    $factors = [];

    if ($humidity >= 85) {
        $riskScore += 2;
        $factors[] = 'mataas ang humidity';
    }

    if ($rainNext12h >= 4 || $highestPop >= 60) {
        $riskScore += 2;
        $factors[] = 'mataas ang tsansa ng ulan sa susunod na 12 oras';
    }

    if (strpos($condition, 'rain') !== false || strpos($condition, 'drizzle') !== false || strpos($condition, 'thunderstorm') !== false) {
        $riskScore += 1;
        $factors[] = 'umuulan o basa ang field conditions';
    }

    if (strpos($description, 'mist') !== false || strpos($description, 'fog') !== false || strpos($description, 'haze') !== false) {
        $riskScore += 1;
        $factors[] = 'may hamog o ambon-like moisture sa paligid';
    }

    $diseasePressure = 'Low';
    if ($riskScore >= 4) {
        $diseasePressure = 'High';
    } elseif ($riskScore >= 2) {
        $diseasePressure = 'Moderate';
    }

    $sprayWindow = 'Good';
    if ($windKph >= 20 || $highestPop >= 70) {
        $sprayWindow = 'Poor';
    } elseif ($windKph >= 12 || $highestPop >= 40 || $humidity >= 85) {
        $sprayWindow = 'Caution';
    }

    $fieldNote = 'Maayos ang kondisyon para sa regular field monitoring.';
    if ($diseasePressure === 'High') {
        $fieldNote = 'Mataas ang weather-driven disease pressure. Unahin ang masinsinang scouting at iwasan ang huling-minutong spraying bago umulan.';
    } elseif ($sprayWindow === 'Poor') {
        $fieldNote = 'Hindi ideal ang spray window ngayon dahil sa hangin o nakaambang ulan.';
    } elseif ($sprayWindow === 'Caution') {
        $fieldNote = 'Pwede ang field action pero kailangan ng mas maingat na timing dahil pabago-bago ang panahon.';
    }

    $probableCauses = [];
    if ($humidity >= 85) {
        $probableCauses[] = 'mataas na halumigmig na nagpapatagal ng basa sa dahon';
    }
    if ($rainNext12h >= 4 || $highestPop >= 60) {
        $probableCauses[] = 'paparating na ulan na puwedeng magpalala ng leaf wetness at pagkalat ng sakit';
    }
    if (strpos($condition, 'cloud') !== false) {
        $probableCauses[] = 'makapal na ulap na maaaring magpanatili ng mamasa-masang kondisyon sa palayan';
    }
    if (strpos($description, 'mist') !== false || strpos($description, 'fog') !== false || strpos($description, 'haze') !== false) {
        $probableCauses[] = 'hamog o ambon na pwedeng magdagdag ng moisture sa paligid';
    }

    return [
        'disease_pressure' => $diseasePressure,
        'spray_window' => $sprayWindow,
        'field_note' => $fieldNote,
        'factors' => $factors,
        'probable_causes' => array_values(array_unique($probableCauses)),
    ];
}

/**
 * Convert raw OpenWeather payloads to app-friendly structure.
 */
function riceguardBuildWeatherSnapshot(array $location, array $currentPayload, array $forecastPayload) {
    $timezoneOffset = (int)($currentPayload['timezone'] ?? 0);
    $forecastEntries = array_slice($forecastPayload['list'] ?? [], 0, 8);
    $observedUnix = (int)($currentPayload['dt'] ?? time());
    $sunriseUnix = (int)($currentPayload['sys']['sunrise'] ?? 0);
    $sunsetUnix = (int)($currentPayload['sys']['sunset'] ?? 0);
    $localObservedUnix = $observedUnix + $timezoneOffset;
    $localHour = (int)gmdate('G', $localObservedUnix);
    $isBeforeSunrise = $sunriseUnix > 0 && $observedUnix < $sunriseUnix;
    $isAfterSunset = $sunsetUnix > 0 && $observedUnix >= $sunsetUnix;
    $isNight = $isBeforeSunrise || $isAfterSunset;

    if ($localHour >= 0 && $localHour < 5) {
        $timePhase = 'madaling araw';
    } elseif ($localHour < 12) {
        $timePhase = 'umaga';
    } elseif ($localHour < 18) {
        $timePhase = 'hapon';
    } else {
        $timePhase = 'gabi';
    }

    $current = [
        'temp_c' => round((float)($currentPayload['main']['temp'] ?? 0), 1),
        'feels_like_c' => round((float)($currentPayload['main']['feels_like'] ?? 0), 1),
        'humidity_pct' => (int)($currentPayload['main']['humidity'] ?? 0),
        'pressure_hpa' => (int)($currentPayload['main']['pressure'] ?? 0),
        'condition' => $currentPayload['weather'][0]['main'] ?? 'Unknown',
        'description' => $currentPayload['weather'][0]['description'] ?? 'Unknown conditions',
        'icon' => $currentPayload['weather'][0]['icon'] ?? null,
        'wind_kph' => round(((float)($currentPayload['wind']['speed'] ?? 0)) * 3.6, 1),
        'clouds_pct' => (int)($currentPayload['clouds']['all'] ?? 0),
        'rain_1h_mm' => round((float)($currentPayload['rain']['1h'] ?? 0), 1),
        'observed_at' => riceguardWeatherFormatLocalTime($observedUnix, $timezoneOffset),
        'observed_clock' => riceguardWeatherFormatLocalTime($observedUnix, $timezoneOffset, 'g:i A'),
        'sunrise_at' => riceguardWeatherFormatLocalTime($sunriseUnix, $timezoneOffset, 'g:i A'),
        'sunset_at' => riceguardWeatherFormatLocalTime($sunsetUnix, $timezoneOffset, 'g:i A'),
        'local_hour' => $localHour,
        'time_phase' => $timePhase,
        'is_before_sunrise' => $isBeforeSunrise,
        'is_after_sunset' => $isAfterSunset,
        'is_night' => $isNight,
    ];

    $highestPop = 0;
    $rainVolume12h = 0.0;
    $maxTemp24h = null;
    $minTemp24h = null;
    $nextRainAt = null;
    $forecastCards = [];

    foreach ($forecastEntries as $entry) {
        $popPct = (int)round(((float)($entry['pop'] ?? 0)) * 100);
        $temp = round((float)($entry['main']['temp'] ?? 0), 1);
        $rain3h = round((float)($entry['rain']['3h'] ?? 0), 1);
        $highestPop = max($highestPop, $popPct);
        $rainVolume12h += $rain3h;
        $maxTemp24h = $maxTemp24h === null ? $temp : max($maxTemp24h, $temp);
        $minTemp24h = $minTemp24h === null ? $temp : min($minTemp24h, $temp);

        if ($nextRainAt === null && ($popPct >= 40 || $rain3h > 0.1)) {
            $nextRainAt = riceguardWeatherFormatLocalTime($entry['dt'] ?? null, $timezoneOffset);
        }

        if (count($forecastCards) < 4) {
            $forecastCards[] = [
                'time' => riceguardWeatherFormatLocalTime($entry['dt'] ?? null, $timezoneOffset, 'g A'),
                'temp_c' => $temp,
                'condition' => $entry['weather'][0]['main'] ?? 'Unknown',
                'description' => $entry['weather'][0]['description'] ?? '',
                'icon' => $entry['weather'][0]['icon'] ?? null,
                'pop_pct' => $popPct,
                'rain_3h_mm' => $rain3h,
            ];
        }
    }

    $forecastSummary = [
        'highest_pop_pct' => $highestPop,
        'rain_volume_12h_mm' => round($rainVolume12h, 1),
        'max_temp_24h_c' => $maxTemp24h !== null ? round((float)$maxTemp24h, 1) : null,
        'min_temp_24h_c' => $minTemp24h !== null ? round((float)$minTemp24h, 1) : null,
        'next_rain_at' => $nextRainAt,
        'summary' => $highestPop >= 60
            ? 'May mataas na posibilidad ng ulan sa susunod na mga oras.'
            : ($highestPop >= 35
                ? 'May posibilidad ng pabugso-bugsong ulan kaya bantayan ang spray timing.'
                : 'Mukhang mas stable ang panahon sa susunod na ilang oras.'),
        'entries' => $forecastCards,
    ];

    $agriculture = riceguardBuildWeatherAgronomy($current, $forecastSummary);
    if ($isNight) {
        $agriculture['field_timing_note'] = "Nasa {$timePhase} pa ngayon ({$current['observed_clock']}), kaya huwag munang mag-spray o maglakad sa basang bukid kung hindi emergency. Maghintay ng liwanag at mas tuyong dahon bago magsagawa ng spraying.";
    } elseif (($agriculture['spray_window'] ?? 'Good') === 'Poor') {
        $agriculture['field_timing_note'] = 'Hindi muna ideal ang pag-spray ngayon dahil sa kasalukuyang weather risk. Mas mabuting maghintay ng mas maayos na timing.';
    } else {
        $agriculture['field_timing_note'] = 'Pwede ang field action sa tamang oras, pero tiyaking tuyo ang dahon at maayos ang hangin bago mag-spray.';
    }

    return [
        'success' => true,
        'location' => [
            'label' => $location['label'],
            'latitude' => $location['latitude'],
            'longitude' => $location['longitude'],
            'source' => $location['source'],
        ],
        'current' => $current,
        'forecast' => $forecastSummary,
        'agriculture' => $agriculture,
        'timezone_offset' => $timezoneOffset,
        'refreshed_at' => riceguardWeatherFormatLocalTime(time(), $timezoneOffset),
        'refreshed_unix' => time(),
    ];
}

/**
 * Public entry point used by both dashboard and AI helper.
 */
function riceguardGetWeatherSnapshot(array $options = []) {
    $config = riceguardGetWeatherConfig();

    if ($config['api_key'] === '') {
        return ['success' => false, 'error' => 'OPENWEATHER_API_KEY is not configured.'];
    }

    $location = riceguardResolveWeatherLocation($options);
    if (!$location) {
        return ['success' => false, 'error' => 'Unable to resolve farmer weather location.'];
    }

    $cacheKey = 'weather_' . md5(sprintf('%.4f|%.4f', $location['latitude'], $location['longitude']));
    $cached = riceguardWeatherReadCache($cacheKey, max(60, $config['cache_ttl']));
    if (is_array($cached)) {
        $cached['cache_hit'] = true;
        return $cached;
    }

    $query = 'lat=' . rawurlencode((string)$location['latitude'])
        . '&lon=' . rawurlencode((string)$location['longitude'])
        . '&appid=' . rawurlencode($config['api_key'])
        . '&units=metric';

    $currentUrl = $config['base_url'] . '/data/2.5/weather?' . $query;
    $forecastUrl = $config['base_url'] . '/data/2.5/forecast?' . $query . '&cnt=8';

    $currentResult = riceguardWeatherJsonGet($currentUrl, 20);
    if (!$currentResult['success']) {
        return $currentResult;
    }

    $forecastResult = riceguardWeatherJsonGet($forecastUrl, 20);
    if (!$forecastResult['success']) {
        return $forecastResult;
    }

    $snapshot = riceguardBuildWeatherSnapshot($location, $currentResult['data'], $forecastResult['data']);
    $snapshot['cache_hit'] = false;

    riceguardWeatherWriteCache($cacheKey, $snapshot);

    return $snapshot;
}

/**
 * Compact weather summary for AI prompts.
 */
function riceguardBuildWeatherPromptContext(array $snapshot) {
    if (empty($snapshot['success'])) {
        return '';
    }

    $current = $snapshot['current'];
    $forecast = $snapshot['forecast'];
    $agriculture = $snapshot['agriculture'];

    $factors = !empty($agriculture['factors'])
        ? implode(', ', $agriculture['factors'])
        : 'walang matinding weather risk factor sa ngayon';
    $probableCauses = !empty($agriculture['probable_causes'])
        ? implode(', ', $agriculture['probable_causes'])
        : 'walang malinaw na weather-driven cause na nangingibabaw ngayon';
    $observedClock = $current['observed_clock'] ?? ($current['observed_at'] ?? 'ngayon');
    $sunriseAt = $current['sunrise_at'] ?? 'hindi available';
    $sunsetAt = $current['sunset_at'] ?? 'hindi available';
    $timePhase = $current['time_phase'] ?? 'kasalukuyang oras';
    $timingNote = $agriculture['field_timing_note']
        ?? 'Iayon ang field action sa oras, ulan, hangin, at basa ng dahon.';
    $timeRule = !empty($current['is_night'])
        ? "Madaling-araw/gabi ngayon ({$observedClock}), kaya hindi ito tamang oras para mag-spray o mag-ikot sa bukid maliban kung emergency."
        : "May liwanag na ngayon ({$observedClock}), pero iayon pa rin ang field action sa hangin, ulan, at leaf wetness.";

    return "WEATHER CONTEXT:\n"
        . "- Current local time sa {$snapshot['location']['label']}: {$current['observed_at']} ({$timePhase}). Sunrise {$sunriseAt}, sunset {$sunsetAt}.\n"
        . "- Current weather sa {$snapshot['location']['label']}: {$current['description']}, {$current['temp_c']}C, feels like {$current['feels_like_c']}C, humidity {$current['humidity_pct']}%, wind {$current['wind_kph']} kph.\n"
        . "- Next 12-24h: {$forecast['summary']} Highest rain chance {$forecast['highest_pop_pct']}%, estimated rain volume {$forecast['rain_volume_12h_mm']} mm, next rain: " . ($forecast['next_rain_at'] ?? 'walang agarang ulan') . ".\n"
        . "- Agronomy lens: disease pressure {$agriculture['disease_pressure']}, spray window {$agriculture['spray_window']}, factors: {$factors}.\n"
        . "- Posibleng sanhi ng risk ngayon: {$probableCauses}.\n"
        . "- Time rule: {$timeRule}\n"
        . "- Field note: {$agriculture['field_note']}\n"
        . "- Timing note: {$timingNote}";
}
?>
