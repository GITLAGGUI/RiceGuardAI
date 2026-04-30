<?php
require_once __DIR__ . '/config.php';

$db = getDB();

// Admin credentials
$adminPhone = '+639123456789'; 
$adminName = 'Admin RiceGuard';

try {
    // Check if account exists
    $stmt = $db->prepare("SELECT id FROM farmers WHERE phone = ?");
    $stmt->execute([$adminPhone]);
    $user = $stmt->fetch();

    if ($user) {
        // Update existing to admin
        $stmt = $db->prepare("UPDATE farmers SET role = 'admin', full_name = ?, phone_verified = 1 WHERE id = ?");
        $stmt->execute([$adminName, $user['id']]);
        echo json_encode(['success' => true, 'message' => "Updated existing user to Admin: $adminPhone"]);
    } else {
        // Create new admin with dummy location data to satisfy schema
        $stmt = $db->prepare("INSERT INTO farmers (full_name, phone, phone_verified, role, province, municipality, barangay) 
                             VALUES (?, ?, 1, 'admin', 'Cagayan', 'Peñablanca', 'Aggub')");
        $stmt->execute([$adminName, $adminPhone]);
        echo json_encode(['success' => true, 'message' => "Created new Admin: $adminPhone"]);
    }
} catch (Exception $e) {
    echo json_encode(['success' => false, 'message' => $e->getMessage()]);
}
