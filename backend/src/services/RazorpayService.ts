import Razorpay from 'razorpay';

let _client: Razorpay | null = null;

/**
 * Returns a configured Razorpay client.
 * Throws if PAYMENT_PROVIDER=razorpay but credentials are missing.
 */
export function getRazorpayClient(): Razorpay {
  if (_client) return _client;

  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    throw new Error(
      'Razorpay credentials are missing. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.'
    );
  }

  _client = new Razorpay({ key_id: keyId, key_secret: keySecret });
  return _client;
}

/**
 * Validates that all required Razorpay env vars are present.
 * Call this once on server startup when PAYMENT_PROVIDER=razorpay.
 */
export function validateRazorpayConfig(): void {
  const missing: string[] = [];
  if (!process.env.RAZORPAY_KEY_ID) missing.push('RAZORPAY_KEY_ID');
  if (!process.env.RAZORPAY_KEY_SECRET) missing.push('RAZORPAY_KEY_SECRET');
  if (!process.env.RAZORPAY_WEBHOOK_SECRET) missing.push('RAZORPAY_WEBHOOK_SECRET');

  if (missing.length > 0) {
    throw new Error(
      `Missing required Razorpay environment variables: ${missing.join(', ')}`
    );
  }

  console.log('[payment] Razorpay TEST MODE configured — key_id:', process.env.RAZORPAY_KEY_ID);
}

export function isRazorpayMode(): boolean {
  return (process.env.PAYMENT_PROVIDER ?? 'local') === 'razorpay';
}
