import { PlanChoiceMemo } from "@/components/auth/plan-choice-memo";
import { RegisterForm } from "@/components/auth/register-form";

// Obecná registrace Splatna: založení firemního účtu. S R. Hlavica nesouvisí.
export default function RegisterPage() {
  return (
    <>
      <PlanChoiceMemo />
      <RegisterForm brand="splatno" />
    </>
  );
}
