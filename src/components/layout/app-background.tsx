import styles from "./app-background.module.css";

/** One fixed, decorative layer for every internal route; never a layout item. */
export function AppBackground({ variant }: { variant?: string }) {
  return (
    <div
      className={`workspace-background ${styles.background}`}
      data-variant={variant}
      aria-hidden="true"
    >
      <svg viewBox="0 0 1536 1024" preserveAspectRatio="none" focusable="false">
        <defs>
          <linearGradient
            id="workspace-mint-upper"
            x1="0"
            y1="0"
            x2=".7"
            y2="1"
          >
            <stop stopColor="#e0eee5" stopOpacity=".12" />
            <stop offset="1" stopColor="#dcece3" stopOpacity=".45" />
          </linearGradient>
          <linearGradient id="workspace-mint-lower" x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#d3e6db" stopOpacity=".5" />
            <stop offset="1" stopColor="#eff6f1" stopOpacity=".06" />
          </linearGradient>
        </defs>
        <path
          d="M700-60H1536V170C1374 67 1253 83 1110 131C971 178 888 167 765 128C871 113 943 50 1003-30Z"
          fill="url(#workspace-mint-upper)"
        />
        <path
          d="M-120 685C112 723 165 860 310 973C359 1011 420 1050 485 1080H-120Z"
          fill="url(#workspace-mint-lower)"
        />
        <path
          d="M-120 760C74 781 128 905 260 1022L350 1080H-120Z"
          fill="#dbece1"
          opacity=".47"
        />
        <path
          d="M-120 835C38 818 111 943 204 1040L240 1080H-120Z"
          fill="#cee3d6"
          opacity=".32"
        />
      </svg>
    </div>
  );
}
