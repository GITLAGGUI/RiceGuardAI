<?php
/**
 * RiceGuard AI - Authentication API
 * 
 * Endpoints:
 *   POST ?action=register  — Create farmer account + send OTP
 *   POST ?action=login     — Send OTP to existing farmer
 *   POST ?action=verify    — Verify OTP code → return session token
 *   GET  ?action=check     — Validate session token
 *   POST ?action=logout    — Invalidate session token
 *   POST ?action=resend    — Resend OTP to phone
 */

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/sms.php';

$action = $_GET['action'] ?? '';
$body = getRequestBody();

switch ($action) {

    /* ──────── REGISTER ──────── */
    case 'register':
        $fullName     = trim($body['full_name'] ?? '');
        $phone        = normalizePhone($body['phone'] ?? '');
        $province     = trim($body['province'] ?? '');
        $municipality = trim($body['municipality'] ?? '');
        $barangay     = trim($body['barangay'] ?? '');
        $farmSize     = $body['farm_size'] ?? null;

        // Validate
        if (!$fullName) jsonResponse(['error' => true, 'message' => 'Full name is required'], 400);
        if (!preg_match('/^\+63\d{10}$/', $phone)) jsonResponse(['error' => true, 'message' => 'Invalid phone number format. Use +63 followed by 10 digits.'], 400);
        if (!$province) jsonResponse(['error' => true, 'message' => 'Province is required'], 400);
        if (!$municipality) jsonResponse(['error' => true, 'message' => 'Municipality is required'], 400);
        if (!$barangay) jsonResponse(['error' => true, 'message' => 'Barangay is required'], 400);

        $db = getDB();
        ensureAuthSchema($db);

        // Check if phone already registered
        $phoneCandidates = getPhoneVariants($phone);
        $placeholders = implode(', ', array_fill(0, count($phoneCandidates), '?'));
        $stmt = $db->prepare("SELECT id FROM farmers WHERE phone IN ($placeholders)");
        $stmt->execute($phoneCandidates);
        if ($stmt->fetch()) {
            jsonResponse(['error' => true, 'message' => 'This phone number is already registered. Please log in.'], 409);
        }

        // Rate limit check
        if (isRateLimited($phone)) {
            jsonResponse(['error' => true, 'message' => 'Too many OTP requests. Please wait before trying again.'], 429);
        }

        // Create farmer
        $stmt = $db->prepare(
            "INSERT INTO farmers (full_name, phone, province, municipality, barangay, farm_size, created_at) 
             VALUES (?, ?, ?, ?, ?, ?, NOW())"
        );
        $stmt->execute([$fullName, $phone, $province, $municipality, $barangay, $farmSize]);

        // Send OTP
        $otpResult = sendOTP($phone);
        $sent = (bool)($otpResult['success'] ?? false);

        logAuthAction($phone, 'otp_sent');

        jsonResponse([
            'success' => true,
            'message' => $sent 
                ? 'Account created! OTP sent to your phone.' 
                : 'Account created, but SMS sending failed. Please try resending the OTP.',
            'otp_sent' => $sent
        ], 201);
        break;

    /* ──────── LOGIN (Send OTP) ──────── */
    case 'login':
        $phone = normalizePhone($body['phone'] ?? '');

        if (!preg_match('/^\+63\d{10}$/', $phone)) {
            jsonResponse(['error' => true, 'message' => 'Invalid phone number format. Use +63 followed by 10 digits.'], 400);
        }

        $db = getDB();
        ensureAuthSchema($db);

        // Check if farmer exists (search all phone variants)
        $phoneCandidates = getPhoneVariants($phone);
        $placeholders = implode(', ', array_fill(0, count($phoneCandidates), '?'));
        $stmt = $db->prepare("SELECT id, full_name, phone FROM farmers WHERE phone IN ($placeholders) LIMIT 1");
        $stmt->execute($phoneCandidates);
        $farmer = $stmt->fetch();

        if (!$farmer) {
            jsonResponse(['error' => true, 'message' => 'No account found with this number. Please register first.'], 404);
        }

        // Rate limit check
        if (isRateLimited($phone)) {
            jsonResponse(['error' => true, 'message' => 'Too many OTP requests. Please try again later.'], 429);
        }

        // Always send OTP — OTP is the login credential
        $otpResult = sendOTP($farmer['phone']); // use the exact phone stored in DB
        $sent = (bool)($otpResult['success'] ?? false);

        logAuthAction($phone, 'otp_sent');

        if (!$sent) {
            jsonResponse([
                'error' => true,
                'message' => 'OTP could not be sent. Make sure your SMS Gate app is online, then try again.',
            ], 502);
        }

        jsonResponse([
            'success' => true,
            'message' => 'Verification code sent to your phone!',
            'otp_sent' => true,
            'farmer_name' => $farmer['full_name'],
        ]);
        break;

    /* ──────── VERIFY OTP → Create session ──────── */
    case 'verify':
        $phone = normalizePhone($body['phone'] ?? '');
        $code  = normalizeOtpCode($body['code'] ?? '');

        if (!$phone || !$code) {
            jsonResponse(['error' => true, 'message' => 'Phone and code are required'], 400);
        }

        if (strlen($code) !== OTP_LENGTH) {
            jsonResponse(['error' => true, 'message' => 'Invalid code format. Please enter a 6-digit code.'], 400);
        }

        $result = verifyOTP($phone, $code);

        if (!is_array($result)) {
            jsonResponse(['error' => true, 'message' => 'Verification failed. Please try again.'], 500);
        }

        if (!$result['valid']) {
            $messages = [
                'invalid' => 'Incorrect code. Please check and try again.',
                'used'    => 'This code has already been used. Please request a new one.',
                'expired' => 'Code has expired. Please request a new one.',
            ];
            $msg = $messages[$result['reason']] ?? 'Verification failed. Please try again.';

            logAuthAction($phone, 'login_failed');
            jsonResponse(['error' => true, 'message' => $msg], 401);
        }

        // OTP valid — mark phone verified & create session
        $db = getDB();
        ensureAuthSchema($db);

        // Update phone_verified flag
        $phoneCandidates = getPhoneVariants($phone);
        $placeholders = implode(', ', array_fill(0, count($phoneCandidates), '?'));
        $stmt = $db->prepare("UPDATE farmers SET phone_verified = 1 WHERE phone IN ($placeholders)");
        $stmt->execute($phoneCandidates);

        // Get the farmer
        $stmt = $db->prepare(
            "SELECT id, full_name, phone, role, province, municipality, barangay, farm_size, created_at
             FROM farmers WHERE phone IN ($placeholders) LIMIT 1"
        );
        $stmt->execute($phoneCandidates);
        $farmer = $stmt->fetch();

        if (!$farmer) {
            jsonResponse(['error' => true, 'message' => 'Account not found after verification.'], 500);
        }

        // Create session token
        $token = createSession($farmer['id']);

        logAuthAction($phone, 'otp_verified');
        logAuthAction($phone, 'login_success');

        jsonResponse([
            'success' => true,
            'message' => 'Login successful!',
            'token'   => $token,
            'farmer'  => [
                'id'           => (int)$farmer['id'],
                'full_name'    => $farmer['full_name'],
                'phone'        => $farmer['phone'],
                'role'         => $farmer['role'],
                'province'     => $farmer['province'],
                'municipality' => $farmer['municipality'],
                'barangay'     => $farmer['barangay'],
                'farm_size'    => $farmer['farm_size'],
                'created_at'   => $farmer['created_at'],
            ]
        ]);
        break;

    /* ──────── CHECK SESSION ──────── */
    case 'check':
        $farmer = getAuthenticatedFarmer();
        if ($farmer) {
            jsonResponse([
                'authenticated' => true,
                'farmer' => $farmer,
            ]);
        } else {
            jsonResponse(['authenticated' => false], 401);
        }
        break;

    /* ──────── LOGOUT ──────── */
    case 'logout':
        $header = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
        if (preg_match('/^Bearer\s+(.+)$/i', $header, $matches)) {
            $token = trim($matches[1]);
            $db = getDB();
            $stmt = $db->prepare("DELETE FROM sessions WHERE token = ?");
            $stmt->execute([$token]);
        }
        jsonResponse(['success' => true, 'message' => 'Logged out successfully.']);
        break;

    /* ──────── RESEND OTP ──────── */
    case 'resend':
        $phone = normalizePhone($body['phone'] ?? '');

        if (!preg_match('/^\+63\d{10}$/', $phone)) {
            jsonResponse(['error' => true, 'message' => 'Invalid phone number format.'], 400);
        }

        if (isRateLimited($phone)) {
            jsonResponse(['error' => true, 'message' => 'Too many OTP requests. Please wait before trying again.'], 429);
        }

        $otpResult = sendOTP($phone);
        $sent = (bool)($otpResult['success'] ?? false);

        logAuthAction($phone, 'otp_sent');

        if (!$sent) {
            jsonResponse(['error' => true, 'message' => 'OTP could not be sent. Check your SMS Gate app.'], 502);
        }

        jsonResponse(['success' => true, 'message' => 'New verification code sent!']);
        break;

    default:
        jsonResponse(['error' => true, 'message' => 'Invalid action'], 400);
}
