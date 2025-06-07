import { useState } from "react";

export interface ProgressStep {
  id: string;
  title: string;
  status: "pending" | "active" | "completed" | "error";
  details?: string;
  startTime?: Date;
  endTime?: Date;
}

export function useProgressTracker(): {
  steps: Array<ProgressStep>;
  addStep: (id: string, title: string, details?: string) => void;
  updateStep: (id: string, updates: Partial<ProgressStep>) => void;
  startStep: (id: string) => void;
  completeStep: (id: string, details?: string) => void;
  errorStep: (id: string, details?: string) => void;
  reset: () => void;
} {
  const [steps, setSteps] = useState<Array<ProgressStep>>([]);

  const addStep = (id: string, title: string, details?: string) => {
    setSteps((prev) => [
      ...prev,
      {
        id,
        title,
        status: "pending",
        details,
      },
    ]);
  };

  const updateStep = (id: string, updates: Partial<ProgressStep>) => {
    setSteps((prev) =>
      prev.map((step) => {
        if (step.id === id) {
          const updated = { ...step, ...updates };

          // Auto-set timing based on status changes
          if (updates.status === "active" && !step.startTime) {
            updated.startTime = new Date();
          } else if (
            (updates.status === "completed" || updates.status === "error") &&
            !step.endTime
          ) {
            updated.endTime = new Date();
          }

          return updated;
        }
        return step;
      }),
    );
  };

  const startStep = (id: string) => {
    updateStep(id, { status: "active", startTime: new Date() });
  };

  const completeStep = (id: string, details?: string) => {
    updateStep(id, { status: "completed", endTime: new Date(), details });
  };

  const errorStep = (id: string, details?: string) => {
    updateStep(id, { status: "error", endTime: new Date(), details });
  };

  const reset = () => {
    setSteps([]);
  };

  return {
    steps,
    addStep,
    updateStep,
    startStep,
    completeStep,
    errorStep,
    reset,
  };
}
