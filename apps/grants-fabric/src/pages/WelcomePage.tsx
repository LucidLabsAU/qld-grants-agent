export function WelcomePage({ onOpen }: { onOpen: (view: 'workbench' | 'table') => void }) {
  return <div className="welcome-page">
    <section className="welcome-hero" aria-labelledby="welcome-title">
      <div>
        <h2 id="welcome-title">A clearer view of Queensland grants.</h2>
        <p>GrantFin is your private space to explore funding, compare the evidence and keep a review trail.
          An evidence-first research assistant helps you ask better questions before applying.</p>
      </div>
      <div className="welcome-actions">
        <button className="primary" onClick={() => onOpen('workbench')}>Browse and review</button>
        <button onClick={() => onOpen('table')}>View reviewer table</button>
      </div>
    </section>

    <div className="welcome-content">
      <section aria-labelledby="how-it-works">
        <h2 id="how-it-works">How it works</h2>
        <ol className="welcome-steps">
          <li><h3>Bring in your grants</h3><p>Use <strong>Import grants</strong> to upload normalized grant JSON from the project feeds.
            Imports add or update your private catalogue and preserve the previous evidence before a grant changes.</p></li>
          <li><h3>Explore and review</h3><p>Use Browse and review to search Queensland grants, check current opening and closing dates,
            and read a selected grant's evidence. Record your decision, questions and next steps.</p></li>
          <li><h3>Compare the details</h3><p>Use Reviewer table to filter and sort every stored field, inspect old grant versions and review previous decisions.
            Long evidence expands when you need it. Select a title to return to its current grant.</p></li>
          <li><h3>Ask with evidence</h3><p>Ask about the selected grant or search your matching catalogue. Answers retrieve stored evidence and cite sources.
            Each saved response has a timestamp and a copy control.</p></li>
        </ol>
      </section>

      <aside className="welcome-data" aria-labelledby="your-evidence">
        <h2 id="your-evidence">Where your evidence lives</h2>
        <dl>
          <div><dt>Your private catalogue</dt><dd>Fabric SQL stores grants and archived versions, scoped to your signed-in identity.</dd></div>
          <div><dt>Your review trail</dt><dd>Reviews are append-only and linked to the grant's content version. Old decisions are not silently rewritten.</dd></div>
          <div><dt>Your conversation history</dt><dd>Questions, answers, citations and timestamps are saved in SQL. Each new question retrieves fresh evidence, rather than reusing the conversation as model memory.</dd></div>
        </dl>
        <details><summary>What powers GrantFin?</summary><p>Microsoft Fabric and Rayfin provide sign-in, data, hosting and functions.
          The GitHub Copilot SDK connects the research assistant to an Azure OpenAI model.
          Retrieval uses keywords over your stored Queensland grants, not an exhaustive or live web search.</p></details>
      </aside>
    </div>

    <p className="welcome-caution"><strong>Research support, not an eligibility decision.</strong> GrantFin is an independent prototype,
      not a Queensland Government service. Imports are manual, and availability can change between imports.
      Always confirm current amounts, dates and requirements with the issuing agency.
      Versions overwritten before archiving was introduced cannot be recovered.</p>
  </div>;
}
