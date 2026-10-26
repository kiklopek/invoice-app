import { Icon } from "@/components/icons";
import { ChevronDown } from "@/components/chevron-down";

const steps = [
  { title: "Najdeme odpovídající faktury", description: "U navržených shod uvidíte důvod přiřazení. Výsledek můžete zkontrolovat a upravit." },
  { title: "Vyřešíte nejasné položky", description: "Platby bez jednoznačné shody můžete ručně přiřadit, rozdělit nebo ponechat nespárované." },
  { title: "Potvrdíte zaúčtování", description: "V režimu kontroly se platby zapíší až po potvrzení. Při zapnutém automatu se jednoznačné shody zpracují na pozadí." },
];

function ProcessSteps() {
  return <ol>{steps.map(step => <li key={step.title}><strong>{step.title}</strong><span>{step.description}</span></li>)}</ol>;
}

export function BankMatchingProcessInfo() {
  return <>
    <aside className="gpc-safety-card" aria-label="Jak funguje párování plateb">
      <span className="gpc-safety-icon"><Icon name="check"/></span>
      <h3>Párování pod kontrolou</h3>
      <ProcessSteps/>
    </aside>
    <details className="gpc-mobile-info">
      <summary>
        <span className="gpc-info-icon"><Icon name="statement"/></span>
        <span><strong>Párování pod kontrolou</strong><span>Po nahrání uvidíte navržené shody a platby, které potřebují kontrolu.</span></span>
        <ChevronDown/>
      </summary>
      <ProcessSteps/>
    </details>
  </>;
}
