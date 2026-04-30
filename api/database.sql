-- ============================================
-- RiceGuard AI - Database Schema
-- Run this in phpMyAdmin or MySQL CLI:
--   mysql -u root < api/database.sql
-- ============================================

CREATE DATABASE IF NOT EXISTS `riceguardai_db` CHARACTER
SET
    utf8mb4 COLLATE utf8mb4_unicode_ci;

USE `riceguardai_db`;

-- ============================================
-- CORE TABLES
-- ============================================

-- Farmers table
CREATE TABLE IF NOT EXISTS `farmers` (
    `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `full_name` VARCHAR(255) NOT NULL,
    `phone` VARCHAR(20) NOT NULL UNIQUE,
    `phone_verified` TINYINT(1) NOT NULL DEFAULT 0,
    `role` ENUM('farmer', 'admin') NOT NULL DEFAULT 'farmer',
    `province` VARCHAR(100) NOT NULL DEFAULT '',
    `municipality` VARCHAR(100) NOT NULL DEFAULT '',
    `barangay` VARCHAR(100) NOT NULL DEFAULT '',
    `farm_size` DECIMAL(10, 2) DEFAULT NULL COMMENT 'Farm size in hectares',
    `is_active` TINYINT(1) DEFAULT 1,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX `idx_phone` (`phone`),
    INDEX `idx_province` (`province`),
    INDEX `idx_location` (
        `province`,
        `municipality`,
        `barangay`
    )
) ENGINE = InnoDB;

-- OTP codes table
CREATE TABLE IF NOT EXISTS `otp_codes` (
    `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `phone` VARCHAR(20) NOT NULL,
    `code` VARCHAR(6) NOT NULL,
    `expires_at` DATETIME NOT NULL,
    `used` TINYINT(1) DEFAULT 0,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX `idx_phone_code` (`phone`, `code`),
    INDEX `idx_expires` (`expires_at`)
) ENGINE = InnoDB;

-- ============================================
-- AUTH & SESSION TABLES
-- ============================================

-- Token-based sessions (replaces PHP $_SESSION for cross-origin React)
CREATE TABLE IF NOT EXISTS `sessions` (
    `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `farmer_id` INT UNSIGNED NOT NULL,
    `token` VARCHAR(128) NOT NULL UNIQUE,
    `expires_at` DATETIME NOT NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (`farmer_id`) REFERENCES `farmers`(`id`) ON DELETE CASCADE,
    INDEX `idx_token` (`token`),
    INDEX `idx_expires` (`expires_at`)
) ENGINE = InnoDB;

-- Login audit trail for rate limiting & security
CREATE TABLE IF NOT EXISTS `login_audit` (
    `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `phone` VARCHAR(20) NOT NULL,
    `action` ENUM('otp_sent', 'otp_verified', 'login_success', 'login_failed') NOT NULL,
    `ip_address` VARCHAR(45) DEFAULT NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX `idx_phone_time` (`phone`, `created_at`)
) ENGINE = InnoDB;

-- ============================================
-- APPLICATION TABLES
-- ============================================

-- Alert history table (for tracking sent alerts)
CREATE TABLE IF NOT EXISTS `alert_history` (
    `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `farmer_id` INT UNSIGNED DEFAULT NULL,
    `phone` VARCHAR(20) NOT NULL,
    `disease` VARCHAR(100) NOT NULL,
    `severity` VARCHAR(50) NOT NULL,
    `location` VARCHAR(255) NOT NULL,
    `advice` TEXT,
    `sent_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `delivery_status` ENUM('sent', 'delivered', 'failed') DEFAULT 'sent',
    FOREIGN KEY (`farmer_id`) REFERENCES `farmers`(`id`) ON DELETE SET NULL,
    INDEX `idx_farmer` (`farmer_id`),
    INDEX `idx_sent_at` (`sent_at`)
) ENGINE = InnoDB;

-- Notification preferences table
CREATE TABLE IF NOT EXISTS `notification_preferences` (
    `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `farmer_id` INT UNSIGNED NOT NULL UNIQUE,
    `sms_enabled` TINYINT(1) DEFAULT 1,
    `critical_alerts` TINYINT(1) DEFAULT 1,
    `weekly_summary` TINYINT(1) DEFAULT 0,
    `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (`farmer_id`) REFERENCES `farmers`(`id`) ON DELETE CASCADE,
    INDEX `idx_farmer_prefs` (`farmer_id`)
) ENGINE = InnoDB;

-- ============================================
-- AI & MAPPING TABLES
-- ============================================

-- Drone Scans uploaded by Admin
CREATE TABLE IF NOT EXISTS `drone_scans` (
    `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `admin_id` INT UNSIGNED NOT NULL,
    `scan_name` VARCHAR(150) NOT NULL DEFAULT '',
    `source_type` ENUM('web_upload', 'manual_entry', 'mock', 'external_inference') NOT NULL DEFAULT 'web_upload',
    `original_filename` VARCHAR(255) DEFAULT NULL,
    `stored_path` VARCHAR(255) DEFAULT NULL,
    `mime_type` VARCHAR(100) DEFAULT NULL,
    `file_size_bytes` BIGINT UNSIGNED DEFAULT NULL,
    `captured_at` DATETIME DEFAULT NULL,
    `scan_date` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `processed_at` DATETIME DEFAULT NULL,
    `notes` TEXT DEFAULT NULL,
    `status` ENUM('pending', 'processing', 'completed', 'failed') NOT NULL DEFAULT 'pending',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (`admin_id`) REFERENCES `farmers`(`id`) ON DELETE CASCADE
) ENGINE = InnoDB;

-- Disease Detections from AI for Map Plotting
CREATE TABLE IF NOT EXISTS `disease_detections` (
    `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `scan_id` INT UNSIGNED NOT NULL,
    `farmer_id` INT UNSIGNED DEFAULT NULL,
    `disease` VARCHAR(100) NOT NULL,
    `severity` ENUM('Low', 'Medium', 'High') NOT NULL,
    `location_text` VARCHAR(255) NOT NULL DEFAULT '',
    `latitude` DECIMAL(10, 8) NOT NULL,
    `longitude` DECIMAL(11, 8) NOT NULL,
    `confidence_score` DECIMAL(5, 4) DEFAULT NULL,
    `affected_area_pct` DECIMAL(6, 2) DEFAULT NULL,
    `bbox_json` TEXT DEFAULT NULL,
    `mask_path` VARCHAR(255) DEFAULT NULL,
    `meta_json` LONGTEXT DEFAULT NULL,
    `image_url` VARCHAR(255) NOT NULL DEFAULT '',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (`scan_id`) REFERENCES `drone_scans`(`id`) ON DELETE CASCADE,
    FOREIGN KEY (`farmer_id`) REFERENCES `farmers`(`id`) ON DELETE SET NULL,
    INDEX `idx_scan` (`scan_id`),
    INDEX `idx_farmer` (`farmer_id`),
    INDEX `idx_coordinates` (`latitude`, `longitude`)
) ENGINE = InnoDB;

-- Advisories table (admin-controlled advisory pipeline)
CREATE TABLE IF NOT EXISTS `advisories` (
    `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `admin_id` INT UNSIGNED NOT NULL,
    `farmer_id` INT UNSIGNED DEFAULT NULL,
    `detection_id` INT UNSIGNED DEFAULT NULL,
    `disease` VARCHAR(100) NOT NULL,
    `severity` VARCHAR(50) NOT NULL,
    `location_text` VARCHAR(255) NOT NULL DEFAULT '',
    `latitude` DECIMAL(10, 8) DEFAULT NULL,
    `longitude` DECIMAL(11, 8) DEFAULT NULL,
    `advice_text` TEXT NOT NULL,
    `ai_generated` TINYINT(1) DEFAULT 0,
    `admin_approved` TINYINT(1) DEFAULT 0,
    `sms_sent` TINYINT(1) DEFAULT 0,
    `website_url` VARCHAR(255) DEFAULT 'http://localhost:5173/farmer/map',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (`admin_id`) REFERENCES `farmers`(`id`),
    FOREIGN KEY (`farmer_id`) REFERENCES `farmers`(`id`) ON DELETE SET NULL,
    FOREIGN KEY (`detection_id`) REFERENCES `disease_detections`(`id`) ON DELETE SET NULL,
    INDEX `idx_farmer_advisory` (`farmer_id`),
    INDEX `idx_admin_advisory` (`admin_id`),
    INDEX `idx_approved` (`admin_approved`)
) ENGINE = InnoDB;

-- ============================================
-- CLEANUP: Remove expired OTPs and sessions
-- Run via CRON or MySQL Event Scheduler
-- ============================================
-- DELETE FROM otp_codes WHERE expires_at < NOW();
-- DELETE FROM sessions WHERE expires_at < NOW();
