<?php
require_once __DIR__ . '/config.php';

$db = getDB();

$adminPhone = '+639998887776'; // Brand new number
$adminName = 'Test Admin';

try {
    $stmt = $db->prepare("INSERT INTO farmers (full_name, phone, phone_verified, role, province, municipality, barangay) 
                         VALUES (?, ?, 1, 'admin', 'Cagayan', 'Peñablanca', 'Aggub')");
    $stmt->execute([$adminName, $adminPhone]);
    echo "SUCCESS: Created test admin with phone 639998887776";
} catch (Exception $e) {
    echo "ERROR: " . $e->getMessage();
}
