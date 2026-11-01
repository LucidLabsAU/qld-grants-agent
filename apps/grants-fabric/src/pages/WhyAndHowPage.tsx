export function WhyAndHowPage() {
  return <article className="story-content">
      <div className="story-intro">
        <p className="story-eyebrow">The story behind GrantFin</p>
        <h1>Why and How we built this</h1>
        <p className="story-lead">Finding funding is only the beginning. We wanted a place to understand the source,
          see what is missing, and keep the evidence behind every review.</p>
        <p className="story-credit">Made with love by <a href="https://github.com/keith-oak" target="_blank" rel="noreferrer">keith-oak</a>.</p>
      </div>

      <div className="story-grid">
        <section className="story-section" aria-labelledby="story-why">
          <h2 id="story-why">From discovery to a review trail</h2>
          <p>Grant information is spread across agencies, business finders and council portals. A useful answer needs
            more than a program name: funding guidance, dates, eligibility text, application steps and an official link.</p>
          <p>GrantFin brings that evidence together for human review. You can browse programs, compare fields,
            inspect missing data, record decisions against a particular revision, and ask grounded questions.</p>
          <p>It is a research companion, not an eligibility verdict. The issuing agency remains the authority.</p>
        </section>
        <section className="story-section" aria-labelledby="story-inspiration">
          <h2 id="story-inspiration">Inspired by Olaf</h2>
          <p>This work was inspired by <a href="https://github.com/olafwrieden" target="_blank" rel="noreferrer">Olaf Wrieden</a> and
            his <a href="https://github.com/olafwrieden/qld-grants-agent" target="_blank" rel="noreferrer">original Queensland grants agent repository</a>.
            That project is the starting point, and deserves the credit.</p>
          <p>We built on it in the <a href="https://github.com/LucidLabsAU/qld-grants-agent" target="_blank" rel="noreferrer">Lucid Labs fork</a>,
            extending the catalogue, preserving more source evidence, and adding this Fabric-hosted workbench.</p>
          <p>The repository covers two complementary paths: an Azure/Foundry discovery backend and a separate
            Fabric/Rayfin evidence-and-review application. They are not the same retrieval pipeline.</p>
        </section>
      </div>

      <section className="story-section" aria-labelledby="story-flow">
        <h2 id="story-flow">How the evidence moves</h2>
        <ol className="story-flow">
          <li><h3>Collect</h3><p>Read implemented official feeds, pages and portals, keeping source IDs and links.</p></li>
          <li><h3>Normalize</h3><p>Retain structured fields and free-text guidance instead of inventing missing values.</p></li>
          <li><h3>Preserve</h3><p>Archive the previous record before an update and link reviews to its content hash.</p></li>
          <li><h3>Research</h3><p>Show the evidence, its gaps and cited answers so a person can decide what to check next.</p></li>
        </ol>
      </section>

      <div className="story-grid">
        <section className="story-section" aria-labelledby="story-azure">
          <h2 id="story-azure">The Azure and Foundry path</h2>
          <p>A TypeScript Azure Function runs the scheduled ingestion. It normalizes and deduplicates source records,
            tracks content changes, archives revisions and stages JSON in Blob Storage. Missing programs are soft-deleted.</p>
          <p>Azure AI Search pulls the blobs, embeds titles and descriptions with a Foundry model, and supports keyword,
            vector, hybrid and semantic search. A FoundryIQ knowledge base sits over that index; the YAML-defined
            Foundry prompt agent retrieves through MCP before answering.</p>
          <p>The separate Edge/Chrome extension and localhost authentication bridge demonstrate a companion on
            the existing grants website. They are a prototype experience, not a modification to the public site.</p>
        </section>
        <section className="story-section" aria-labelledby="story-fabric">
          <h2 id="story-fabric">The Microsoft Fabric and Rayfin path</h2>
          <p>This app uses React, TypeScript and Vite, with Rayfin providing Fabric authentication, SQL data,
            static hosting and functions. The interface follows the Queensland Government Design System without
            claiming to be an official government service.</p>
          <p><code>GrantRecord</code>, <code>GrantVersion</code>, <code>GrantReview</code> and <code>ChatTurn</code> store
            current evidence, historical snapshots, append-only reviews and cited answers. Data access is scoped
            to the signed-in caller; another person's catalogue and notes are not shared automatically.</p>
          <p>Imports are manual and additive. An archive failure blocks an overwrite, stable record IDs keep reviews
            connected, and an expanded schema retains program/round, amounts, date guidance, classifications,
            agencies, application evidence and source metadata.</p>
        </section>
        <section className="story-section" aria-labelledby="story-chat">
          <h2 id="story-chat">Grounded chat, with clear boundaries</h2>
          <p>The Fabric function keyword-ranks the caller's stored grants, applies Queensland and current-date
            filters, and supplies a bounded evidence set to an isolated GitHub Copilot SDK session.</p>
          <p>Azure OpenAI supplies the model using an Entra bearer token, not an API key. The model token currently
            uses the app owner's external identity; SQL retrieval remains caller-scoped. Tools and configuration
            discovery are disabled, and empty or invalidly cited answers are rejected.</p>
          <p>Successful answers retain source URLs and revision hashes in SQL. Each question retrieves evidence
            independently; saved chat history is not model conversational memory. This path does not currently
            use the root project's vector index or FoundryIQ retrieval.</p>
        </section>
        <section className="story-section" aria-labelledby="story-quality">
          <h2 id="story-quality">Data quality and engineering choices</h2>
          <p>Source and program matrices expose field availability. Full-cell green fills show completeness;
            click to switch a count to a percentage. A missing field can mean unknown information or something
            that genuinely does not apply. Completeness is not accuracy, freshness or eligibility.</p>
          <p>The repository includes Bicep infrastructure, managed identities and RBAC, declarative search/agent
            definitions, pure unit tests and explicit import safeguards. The Fabric deployment wrapper packages
            the Copilot SDK's native Linux runtime as well as the JavaScript functions.</p>
          <p>Implemented accessible sources are covered, not every grant on the internet. Public Queensland funding
            datasets are an explicit alternative to the protected feed; unimplemented sources such as GrantConnect
            remain outside this catalogue. Imported records are snapshots, not live web results.</p>
        </section>
      </div>

      <section className="story-section story-access" aria-labelledby="story-access">
        <h2 id="story-access">Microsoft sign-in, not open access</h2>
        <p>We want to make trying this easy for Microsoft employees. Today, the existing Fabric sign-in,
          owning-tenant permissions and protected hosting still apply. Employee access is not yet enabled
          tenant-wide, and allowing a tenant alone would not grant access to this Fabric item.</p>
        <p>Any broader sharing must preserve caller-private grants, reviews and chat, and be verified with
          a permitted external user before we call it supported.</p>
      </section>
  </article>;
}
