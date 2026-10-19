import { useState } from 'react'
import { Flower2, Plus, TreeDeciduous } from 'lucide-react'

import { Button } from '../ui/Button'
import { ChoiceTiles } from '../ui/ChoiceTiles'
import { DateChips } from '../ui/DateChips'
import { Disclosure } from '../ui/Disclosure'
import { Field } from '../ui/Field'
import { Journey } from '../ui/Journey'
import { Stepper } from '../ui/Stepper'
import { SyncBadge, SyncChip } from '../ui/Sync'
import { TrustSeal } from '../ui/TrustSeal'
import styles from './DesignPage.module.css'

type Honey = 'acacia' | 'wildflower' | 'other'

// Dev-only review page (excluded from production builds by the router). Every
// primitive in every state, for design review and for the axe test. The copy
// here is review scaffolding, not product copy, so it is not translated.
export default function DesignPage() {
  const [hives, setHives] = useState(6)
  const [honey, setHoney] = useState<Honey>('acacia')
  const [date, setDate] = useState('2026-10-13')
  return (
    <main className={styles.page}>
      <h1 className="serif">Design system</h1>
      <section className={styles.group}>
        <h2>Trust seal</h2>
        <TrustSeal state="sealed" stepsDone={6} />
        <TrustSeal state="sealing" stepsDone={6} />
        <TrustSeal state="in_progress" stepsDone={5} />
        <TrustSeal state="mismatch" stepsDone={6} />
      </section>
      <section className={styles.group}>
        <h2>Journey</h2>
        <Journey
          steps={[
            { key: 'CREATED', date: '2026-03-02', word: 'recorded' },
            { key: 'HARVESTED', date: '2026-03-09', word: 'harvested' },
            { key: 'PROCESSED', date: '2026-03-14', word: 'recorded' },
            { key: 'LAB_VERIFIED', date: '2026-03-20', word: 'tested' },
            { key: 'PACKAGED', date: null, word: 'recorded' },
            { key: 'DISTRIBUTED', date: null, word: 'recorded' },
          ]}
        />
      </section>
      <section className={styles.group}>
        <h2>Actions</h2>
        <Button full>Save harvest</Button>
        <Button variant="secondary" full>
          Register another
        </Button>
        <Button variant="quiet">Scan another</Button>
        <Button loading full>
          Saving
        </Button>
      </section>
      <section className={styles.group}>
        <h2>Inputs</h2>
        <Field label="Name this apiary" hint="Any name you will recognise">
          {(p) => <input {...p} defaultValue="Ridge" />}
        </Field>
        <Field label="Phone number" error="Enter the number you signed up with">
          {(p) => <input {...p} type="tel" />}
        </Field>
        <Stepper label="Number of hives" value={hives} min={1} max={500} onChange={setHives} />
        <ChoiceTiles<Honey>
          legend="What honey is it mostly?"
          name="honey"
          value={honey}
          onChange={setHoney}
          options={[
            { value: 'acacia', label: 'Acacia', icon: <TreeDeciduous aria-hidden="true" /> },
            { value: 'wildflower', label: 'Wildflower', icon: <Flower2 aria-hidden="true" /> },
            { value: 'other', label: 'Other', icon: <Plus aria-hidden="true" /> },
          ]}
        />
        <DateChips
          legend="When did you harvest?"
          value={date}
          today="2026-10-13"
          onChange={setDate}
        />
      </section>
      <section className={styles.group}>
        <h2>Sync</h2>
        <div className={styles.row}>
          <SyncChip waiting={2} />
          <SyncChip waiting={0} />
        </div>
        <div className={styles.row}>
          <SyncBadge status="local" />
          <SyncBadge status="sending" />
          <SyncBadge status="sent" />
          <SyncBadge status="attention" />
        </div>
      </section>
      <section className={styles.group}>
        <h2>Disclosure</h2>
        <Disclosure summary="How this was checked">
          <p>Each step was saved with a fingerprint, and all seven still match.</p>
        </Disclosure>
      </section>
    </main>
  )
}
