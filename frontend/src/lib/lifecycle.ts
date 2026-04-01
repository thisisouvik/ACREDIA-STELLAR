export type CredentialStatus = 'Draft' | 'Pending_Issuance' | 'Issued' | 'Revoked';
export type Action = 'SUBMIT' | 'CONFIRM' | 'REVOKE' | 'DELETE';

export function getNextStatus(current: CredentialStatus, action: Action): CredentialStatus | null {
  const transitions: Record<CredentialStatus, Partial<Record<Action, CredentialStatus>>> = {
    Draft: { SUBMIT: 'Pending_Issuance', DELETE: null as any },
    Pending_Issuance: { CONFIRM: 'Issued' },
    Issued: { REVOKE: 'Revoked' },
    Revoked: {}
  };

  const next = transitions[current]?.[action];
  if (next === undefined) return null;
  return next;
}

export function validatePayload(payload: any): { valid: boolean; error?: string } {
  if (!payload) return { valid: false, error: 'Payload cannot be null' };
  if (!payload.studentWallet) return { valid: false, error: 'Student wallet is required' };
  if (payload.studentWallet.length < 10) return { valid: false, error: 'Invalid wallet address' };
  
  return { valid: true };
}
