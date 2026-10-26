export type LoginIssueCode =
  | "network"
  | "server"
  | "company"
  | "access"
  | "expired"
  | "timeout"
  | "aborted"
  | "unknown";
export type LoginIssue = {
  code: LoginIssueCode;
  title: string;
  message: string;
  retryable: boolean;
};

export function loginRequestIssue(
  status: number,
  context: "access" | "session",
): LoginIssue {
  if (status === 401)
    return {
      code: "expired",
      title: "Přihlášení vypršelo",
      message: "Přihlaste se prosím znovu.",
      retryable: false,
    };
  if (status === 403)
    return {
      code: "access",
      title: "Nepodařilo se ověřit přístup",
      message:
        "K dokončení přihlášení nemáte potřebná oprávnění. Vraťte se prosím na přihlášení.",
      retryable: false,
    };
  if (status >= 500)
    return {
      code: "server",
      title: "Server momentálně neodpovídá",
      message:
        "Server nemohl dokončit přípravu prostředí. Zkuste to prosím později.",
      retryable: true,
    };
  if (context === "access")
    return {
      code: "company",
      title: "Nepodařilo se načíst firemní údaje",
      message:
        "Firemní prostředí se nepodařilo připravit. Zkuste načtení znovu.",
      retryable: true,
    };
  return unexpectedLoginIssue();
}

export function unexpectedLoginIssue(): LoginIssue {
  return {
    code: "unknown",
    title: "Nastala neočekávaná chyba",
    message:
      "Přípravu aplikace se nepodařilo dokončit. Vraťte se prosím na přihlášení.",
    retryable: false,
  };
}

export function loginTransportIssue(error: unknown): LoginIssue {
  if (error instanceof DOMException && error.name === "TimeoutError")
    return {
      code: "timeout",
      title: "Server momentálně neodpovídá",
      message: "Požadavek se nepodařilo dokončit včas. Zkuste to prosím znovu.",
      retryable: true,
    };
  if (error instanceof DOMException && error.name === "AbortError")
    return {
      code: "aborted",
      title: "Načítání bylo přerušeno",
      message: "Příprava prostředí byla přerušena. Můžete ji zkusit znovu.",
      retryable: true,
    };
  if (error instanceof TypeError)
    return {
      code: "network",
      title: "Chyba připojení",
      message:
        "Nelze se připojit k serveru. Zkontrolujte internetové připojení a zkuste to znovu.",
      retryable: true,
    };
  return unexpectedLoginIssue();
}
