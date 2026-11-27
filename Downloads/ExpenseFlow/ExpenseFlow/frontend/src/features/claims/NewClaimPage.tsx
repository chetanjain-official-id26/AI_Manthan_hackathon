import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { claimsApi } from '@/api/claims';
import { ApiError, errorMessage } from '@/api/client';
import { qk } from '@/api/keys';
import { Button } from '@/components/ui/Button';
import { Banner, Card } from '@/components/ui/Display';
import { Field, Input } from '@/components/ui/Field';

export default function NewClaimPage() {
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const create = useMutation({
    mutationFn: (t: string) => claimsApi.create(t),
    onSuccess: (claim) => {
      void qc.invalidateQueries({ queryKey: qk.claims });
      qc.setQueryData(qk.claim(claim.id), claim);
      navigate(`/claims/${claim.id}/edit`, { replace: true });
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) {
      setError('Give the claim a short title, e.g. “Client visit Pune”.');
      return;
    }
    setError(null);
    create.mutate(t);
  }

  const serverField = create.error instanceof ApiError ? create.error.fieldErrors.title : undefined;

  return (
    <div className="mx-auto max-w-lg">
      <Link to="/claims" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-700 hover:text-slate-900" data-testid="back-to-claims">
        <ArrowLeft className="h-4 w-4" aria-hidden /> My claims
      </Link>
      <h1 className="mb-4 text-xl font-bold text-slate-900">New claim</h1>
      <Card>
        <form onSubmit={submit} noValidate className="space-y-4" data-testid="new-claim-form">
          {create.isError && !serverField && <Banner tone="error">{errorMessage(create.error)}</Banner>}
          <Field label="Title" required error={error ?? serverField} hint="What was this spend for?" testId="claim-title">
            {(p) => (
              <Input
                {...p}
                autoFocus
                maxLength={120}
                placeholder="Client visit Pune"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                data-testid="claim-title"
              />
            )}
          </Field>
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={create.isPending} testId="create-claim">
            Create draft and add lines
          </Button>
        </form>
      </Card>
    </div>
  );
}
