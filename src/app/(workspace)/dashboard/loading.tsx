import styles from "./dashboard-summary.module.css";

export default function DashboardLoading() {
  return (
    <main
      id="obsah"
      className={`content ${styles.page}`}
      aria-busy="true"
      role="status"
      aria-label="Načítání nástěnky"
    >
      <span className={styles.srOnly}>Načítání nástěnky</span>
      <div
        className={styles.chartSkeleton}
        style={{ minHeight: 44, margin: 0 }}
        aria-hidden="true"
      />
      <div
        className={styles.chartSkeleton}
        style={{ minHeight: 80, margin: 0 }}
        aria-hidden="true"
      />
      <div className={styles.metrics} aria-hidden="true">
        {Array.from({ length: 4 }, (_, index) => (
          <div className={styles.metric} key={index}>
            <div
              className={styles.chartSkeleton}
              style={{ width: "100%", minHeight: 88, margin: 0 }}
            />
          </div>
        ))}
      </div>
      <div className={styles.charts} aria-hidden="true">
        {[0, 1].map((index) => (
          <div className={styles.card} key={index}>
            <div
              className={styles.chartSkeleton}
              style={{ minHeight: 180, margin: 0 }}
            />
          </div>
        ))}
      </div>
      <div className={styles.lists} aria-hidden="true">
        {[0, 1].map((index) => (
          <div className={styles.card} key={index}>
            <div
              className={styles.chartSkeleton}
              style={{ minHeight: 260, margin: 0 }}
            />
          </div>
        ))}
      </div>
    </main>
  );
}
