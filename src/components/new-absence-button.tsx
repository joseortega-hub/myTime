"use client";
import { Plus } from "lucide-react";
import { useState } from "react";
import type { WorkCalendarRules } from "@/domain/calendar";
import { AbsenceFormDialog } from "./absence-form";
import { Button } from "./ui";

export function NewAbsenceButton({ rules, defaultDate, label = "Nueva ausencia" }: { rules: WorkCalendarRules; defaultDate?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const date = defaultDate ?? new Date().toISOString().slice(0, 10);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden /> {label}
      </Button>
      <AbsenceFormDialog
        open={open}
        onClose={() => setOpen(false)}
        rules={rules}
        initial={{ type: "VACATION", status: "REQUESTED", startDate: date, endDate: date, portion: "FULL", daysOverride: null, notes: null }}
      />
    </>
  );
}
