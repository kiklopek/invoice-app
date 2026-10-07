import { LoginForm } from "@/components/auth/login-form";

// splatno.cz/hlavica je vstup R. Hlavica: totéž přihlášení jako /login, jen
// s jejich logem. Lidé z R. Hlavica se můžou přihlásit i přes /login.
export default function HlavicaLoginPage() {
  return <LoginForm brand="hlavica" />;
}
