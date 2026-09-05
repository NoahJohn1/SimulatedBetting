'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { FormField } from '@/components/ui/form-field';
import { createSeasonAction, type CreateSeasonFields } from './actions';

const INPUT =
  'h-11 w-full rounded-control border border-line-strong bg-surface-sunken px-3 text-sm';

export function SeasonForm({ defaults }: { defaults: CreateSeasonFields }) {
  const [fields, setFields] = useState<CreateSeasonFields>(defaults);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const set = (key: keyof CreateSeasonFields) => (value: string) =>
    setFields((f) => ({ ...f, [key]: value }));

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await createSeasonAction(fields);
      if (result.ok) setFields(defaults);
      else setError(result.error);
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex flex-col gap-3"
    >
      <FormField label="Name" htmlFor="season-name">
        <input
          id="season-name"
          value={fields.name}
          onChange={(e) => set('name')(e.target.value)}
          required
          className={INPUT}
        />
      </FormField>

      <FormField label="Starts" htmlFor="season-starts">
        <input
          id="season-starts"
          type="date"
          value={fields.startsAt}
          onChange={(e) => set('startsAt')(e.target.value)}
          required
          className={INPUT}
        />
      </FormField>

      <FormField label="Ends" htmlFor="season-ends">
        <input
          id="season-ends"
          type="date"
          value={fields.endsAt}
          onChange={(e) => set('endsAt')(e.target.value)}
          required
          className={INPUT}
        />
      </FormField>

      <FormField
        label="Starting bankroll"
        htmlFor="season-bankroll"
        hint="In dollars, not cents. 10000 is a $10,000 bankroll."
      >
        <input
          id="season-bankroll"
          inputMode="decimal"
          value={fields.startingBankroll}
          onChange={(e) => set('startingBankroll')(e.target.value)}
          className={INPUT}
        />
      </FormField>

      <FormField label="Weekly allowance" htmlFor="season-allowance" hint="In dollars.">
        <input
          id="season-allowance"
          inputMode="decimal"
          value={fields.weeklyAllowance}
          onChange={(e) => set('weeklyAllowance')(e.target.value)}
          className={INPUT}
        />
      </FormField>

      <FormField label="Starting credits" htmlFor="season-credits" hint="In whole credits.">
        <input
          id="season-credits"
          inputMode="decimal"
          value={fields.startingCredits}
          onChange={(e) => set('startingCredits')(e.target.value)}
          className={INPUT}
        />
      </FormField>

      <FormField
        label="Weekly credit allowance"
        htmlFor="season-credit-allowance"
        hint="In whole credits."
      >
        <input
          id="season-credit-allowance"
          inputMode="decimal"
          value={fields.weeklyCreditAllowance}
          onChange={(e) => set('weeklyCreditAllowance')(e.target.value)}
          className={INPUT}
        />
      </FormField>

      <FormField
        label="Allowance weekday"
        htmlFor="season-weekday"
        hint="0 is Sunday. 2 is Tuesday, which matches the NFL week rollover."
      >
        <input
          id="season-weekday"
          inputMode="numeric"
          value={fields.allowanceWeekday}
          onChange={(e) => set('allowanceWeekday')(e.target.value)}
          className={INPUT}
        />
      </FormField>

      {error ? <Callout tone="negative">{error}</Callout> : null}

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? 'Creating…' : 'Create season'}
      </Button>
    </form>
  );
}
