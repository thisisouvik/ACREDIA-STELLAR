import { NextRequest, NextResponse } from 'next/server';
import { getServiceRoleClient } from '@/lib/serverAuth';

export const dynamic = 'force-dynamic';

export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ token: string }> }
) {
    try {
        const { token: rawToken } = await params;
        const token = rawToken?.trim();

        if (!token) {
            return NextResponse.json(
                { success: false, error: 'Token is required' },
                { status: 400 }
            );
        }

        const supabase = getServiceRoleClient();
        const { data, error } = await supabase
            .from('credentials')
            .select(`
                id,
                token_id,
                issued_at,
                revoked,
                revoked_at,
                metadata,
                institution:institutions!credentials_institution_id_fkey (
                    name
                )
            `)
            .eq('token_id', token)
            .maybeSingle();

        if (error) {
            return NextResponse.json(
                { success: false, error: 'Failed to verify credential' },
                { status: 500 }
            );
        }

        if (!data) {
            return NextResponse.json(
                { success: false, error: 'Credential not found' },
                { status: 404 }
            );
        }

        const institution = Array.isArray(data.institution)
            ? data.institution[0]
            : data.institution;

        const credentialData = data.metadata?.credentialData ?? {};
        const safeCredential = {
            tokenId: data.token_id,
            issuedAt: data.issued_at,
            revoked: data.revoked,
            revokedAt: data.revoked_at,
            institutionName: institution?.name ?? credentialData.institutionName ?? null,
            credentialType: credentialData.credentialType ?? null,
            degree: credentialData.degree ?? null,
            major: credentialData.major ?? null,
            issueDate: credentialData.issueDate ?? null,
        };

        return NextResponse.json({
            success: true,
            credential: safeCredential,
        });
    } catch {
        return NextResponse.json(
            { success: false, error: 'Internal server error' },
            { status: 500 }
        );
    }
}
