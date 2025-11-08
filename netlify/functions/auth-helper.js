import { getStore } from "@netlify/blobs";

/**
 * Passphrase validation with rate limiting
 * Any valid 5+ word passphrase is accepted (each stores separate config)
 */

// Rate limit: 10 attempts per hour per IP
const RATE_LIMIT_ATTEMPTS = 10;
const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour in milliseconds

/**
 * Verify passphrase is valid (5+ words)
 * Does NOT check against a specific passphrase - any valid passphrase works
 */
export function verifyPassphrase(providedPassphrase) {
  // Normalize: lowercase, trim, single spaces
  const normalized = providedPassphrase.toLowerCase().trim().replace(/\s+/g, ' ');

  if (!normalized) {
    return false;
  }

  // Check for at least 5 words
  const words = normalized.split(' ');
  return words.length >= 5;
}

/**
 * Check if IP has exceeded rate limit
 */
export async function checkRateLimit(ip) {
  const store = getStore("rate-limits");
  const now = Date.now();

  try {
    // Get existing attempts for this IP
    const data = await store.get(ip, { type: "json" });

    if (!data) {
      // First attempt
      return { allowed: true, remaining: RATE_LIMIT_ATTEMPTS - 1 };
    }

    // Filter out old attempts (outside time window)
    const recentAttempts = data.attempts.filter(
      timestamp => now - timestamp < RATE_LIMIT_WINDOW
    );

    if (recentAttempts.length >= RATE_LIMIT_ATTEMPTS) {
      // Rate limit exceeded
      const oldestAttempt = Math.min(...recentAttempts);
      const resetTime = oldestAttempt + RATE_LIMIT_WINDOW;
      const minutesUntilReset = Math.ceil((resetTime - now) / 60000);

      return {
        allowed: false,
        remaining: 0,
        resetIn: minutesUntilReset
      };
    }

    return {
      allowed: true,
      remaining: RATE_LIMIT_ATTEMPTS - recentAttempts.length - 1
    };
  } catch (error) {
    console.error("Rate limit check error:", error);
    // Allow on error (fail open)
    return { allowed: true, remaining: RATE_LIMIT_ATTEMPTS - 1 };
  }
}

/**
 * Record an authentication attempt
 */
export async function recordAttempt(ip) {
  const store = getStore("rate-limits");
  const now = Date.now();

  try {
    // Get existing attempts
    const data = await store.get(ip, { type: "json" });

    let attempts = data ? data.attempts : [];

    // Filter out old attempts and add new one
    attempts = attempts
      .filter(timestamp => now - timestamp < RATE_LIMIT_WINDOW)
      .concat(now);

    // Store updated attempts
    await store.setJSON(ip, { attempts });
  } catch (error) {
    console.error("Failed to record attempt:", error);
  }
}

/**
 * Authenticate request with passphrase and rate limiting
 */
export async function authenticateRequest(req) {
  // Get client IP
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
             req.headers.get('x-real-ip') ||
             'unknown';

  // Check rate limit first
  const rateCheck = await checkRateLimit(ip);

  if (!rateCheck.allowed) {
    return {
      success: false,
      status: 429,
      error: `Too many attempts. Try again in ${rateCheck.resetIn} minutes.`,
      headers: {
        'X-RateLimit-Limit': RATE_LIMIT_ATTEMPTS.toString(),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': rateCheck.resetIn.toString()
      }
    };
  }

  // Get passphrase from Authorization header
  const authHeader = req.headers.get('authorization');

  if (!authHeader) {
    await recordAttempt(ip);
    return {
      success: false,
      status: 401,
      error: 'Missing authorization header. Use: Authorization: Bearer your-five-word-passphrase',
      headers: {
        'X-RateLimit-Limit': RATE_LIMIT_ATTEMPTS.toString(),
        'X-RateLimit-Remaining': rateCheck.remaining.toString()
      }
    };
  }

  // Extract passphrase (expects "Bearer passphrase")
  const passphrase = authHeader.replace(/^Bearer\s+/i, '');

  if (!verifyPassphrase(passphrase)) {
    await recordAttempt(ip);
    return {
      success: false,
      status: 401,
      error: 'Invalid passphrase: must be at least 5 words separated by spaces',
      headers: {
        'X-RateLimit-Limit': RATE_LIMIT_ATTEMPTS.toString(),
        'X-RateLimit-Remaining': rateCheck.remaining.toString()
      }
    };
  }

  // Success!
  return {
    success: true,
    headers: {
      'X-RateLimit-Limit': RATE_LIMIT_ATTEMPTS.toString(),
      'X-RateLimit-Remaining': rateCheck.remaining.toString()
    }
  };
}

/**
 * Verify authentication and return formatted result
 * Wrapper around authenticateRequest for consistent API
 */
export async function verifyAuth(req, context) {
  const authResult = await authenticateRequest(req);

  return {
    authorized: authResult.success,
    message: authResult.error || 'Authenticated',
    status: authResult.status || 200,
    headers: {
      'Content-Type': 'application/json',
      ...authResult.headers
    }
  };
}

/**
 * Generate a random 5-word passphrase
 */
export function generatePassphrase() {
  const words = [
    'apple', 'banana', 'cherry', 'dragon', 'eagle',
    'forest', 'garden', 'harbor', 'island', 'jungle',
    'kitchen', 'lemon', 'mountain', 'night', 'ocean',
    'paper', 'queen', 'river', 'star', 'thunder',
    'umbrella', 'valley', 'window', 'yellow', 'zebra',
    'blue', 'coffee', 'morning', 'sunshine', 'rainbow'
  ];

  const selected = [];
  for (let i = 0; i < 5; i++) {
    const word = words[Math.floor(Math.random() * words.length)];
    selected.push(word);
  }

  return selected.join(' ');
}
