import { NextResponse } from 'next/server';
import { emailProviderUiPayload } from '@/lib/emailCore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Selected mail transport only. Tokens and API keys stay on the host. */
export function GET() {
  return NextResponse.json(emailProviderUiPayload());
}
