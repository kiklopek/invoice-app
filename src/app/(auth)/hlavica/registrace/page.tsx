import { RegisterForm } from "@/components/auth/register-form";

// Registrace R. Hlavica jako dřív: jen e-mail z jejich firemní domény,
// pozvaný administrátorem firmy, s jejich logem.
export default function HlavicaRegisterPage() {
  return <RegisterForm brand="hlavica" />;
}
