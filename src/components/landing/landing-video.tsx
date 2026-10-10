"use client";

import { useState } from "react";
import { Modal } from "@/components/modal";
import { useI18n } from "@/i18n/client";
import { Play } from "./landing-icons";
import landingStyles from "./landing.module.css";
import styles from "./landing-video.module.css";

const VIDEO_SRC = "/videos/jak-to-funguje.mp4";

export function LandingVideo() {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const copy = useI18n().t.landing.video;

  return (
    <>
      <button
        type="button"
        className={`${landingStyles.playLink} ${styles.trigger}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setFailed(false);
          setOpen(true);
        }}
      >
        <span className={landingStyles.playIcon} aria-hidden="true"><Play /></span>
        <span>
          <strong>{copy.button}</strong>
          <small>{copy.duration}</small>
        </span>
      </button>

      <Modal open={open} onClose={() => setOpen(false)} labelledBy="landing-video-title" className={styles.dialog}>
        <header>
          <h2 id="landing-video-title" className={styles.title}>{copy.title}</h2>
          <button type="button" aria-label={copy.close} onClick={() => setOpen(false)}>×</button>
        </header>
        <video
          className={styles.video}
          src={VIDEO_SRC}
          width={1280}
          height={720}
          controls
          autoPlay
          playsInline
          preload="metadata"
          aria-label={copy.aria}
          onError={() => setFailed(true)}
        >
          <a href={VIDEO_SRC}>{copy.open}</a>
        </video>
        {failed ? <p className={styles.error} role="alert">{copy.failed} <a href={VIDEO_SRC}>{copy.openStandalone}</a></p> : null}
      </Modal>
    </>
  );
}
