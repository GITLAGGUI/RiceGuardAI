<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/weather_helper.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    jsonResponse(['error' => true, 'message' => 'Method not allowed'], 405);
}

$farmer = requireAuth();

$locationText = trim((string)($_GET['location_text'] ?? ''));
$latitude = $_GET['lat'] ?? null;
$longitude = $_GET['lon'] ?? null;

$snapshot = riceguardGetWeatherSnapshot([
    'farmer' => $farmer,
    'farmer_id' => $farmer['id'],
    'location_text' => $locationText,
    'latitude' => $latitude,
    'longitude' => $longitude,
]);

if (empty($snapshot['success'])) {
    jsonResponse([
        'error' => true,
        'message' => $snapshot['error'] ?? 'Unable to fetch weather data.',
    ], 502);
}

jsonResponse([
    'success' => true,
    'weather' => $snapshot,
]);
?>
