export const metadata = {
  title: "About - Argus Panoptes",
  description: "Methodology and data sources for the Texas Library Holdings Report",
};

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="mb-8 text-3xl font-bold text-white">About This Report</h1>

      <div className="space-y-8 text-gray-300">
        <section>
          <h2 className="mb-3 text-xl font-semibold text-white">
            What is Argus Panoptes?
          </h2>
          <p>
            Argus Panoptes is an automated system that scans public library
            catalogs across Texas to determine which challenged and frequently
            banned books are available in each library system. Named after the
            all-seeing giant of Greek mythology, it provides transparency into
            what books Texas residents can actually access at their local
            libraries.
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold text-white">
            Methodology
          </h2>
          <p className="mb-3">
            The system searches for each book by ISBN across all supported
            library catalog systems. For each library, it records:
          </p>
          <ul className="list-disc space-y-1 pl-6">
            <li>Whether the book was found in the catalog</li>
            <li>Number of copies held</li>
            <li>Number of copies currently available</li>
            <li>Which branches hold the book</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold text-white">
            Data Sources
          </h2>
          <p className="mb-3">
            Library catalog data is collected from multiple ILS (Integrated
            Library System) platforms using protocol-specific adapters:
          </p>
          <ul className="list-disc space-y-1 pl-6">
            <li>
              <strong>Apollo/Biblionix</strong> &mdash; XML API for small/rural libraries
            </li>
            <li>
              <strong>SirsiDynix Enterprise</strong> &mdash; Web scraping for major metro systems
            </li>
            <li>
              <strong>Aspen Discovery</strong> &mdash; REST API for mid-size systems
            </li>
            <li>
              <strong>BiblioCommons</strong> &mdash; Web scraping for large urban libraries
            </li>
            <li>
              <strong>Atriuum</strong> &mdash; Web scraping for school/small public libraries
            </li>
            <li>
              <strong>TLC/LS2 PAC</strong> &mdash; REST API
            </li>
            <li>
              <strong>Koha/SRU</strong> &mdash; SRU/MARCXML protocol
            </li>
            <li>
              <strong>Spydus</strong> &mdash; CGI web scraping
            </li>
          </ul>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold text-white">
            Book Classification
          </h2>
          <p>
            Books are classified by audience level (Young Children, Middle
            Grade, Young Adult, Adult) and by the topics that typically lead to
            challenges (e.g., LGBTQ+ Identity, Race & Racism, Sex Education).
            Classification is performed using AI with human review for
            low-confidence results. Each classification includes a confidence
            score.
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold text-white">
            Coverage
          </h2>
          <p>
            The system currently covers 260+ library systems across Texas,
            representing the vast majority of public library service in the
            state. Some systems are not yet connected due to API access
            requirements or technical barriers (Cloudflare WAF, HMAC key
            requirements).
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold text-white">
            Limitations
          </h2>
          <ul className="list-disc space-y-1 pl-6">
            <li>
              Not all library systems in Texas are covered; some require API
              credentials not yet obtained
            </li>
            <li>
              Catalog data reflects a point-in-time snapshot and may not
              reflect real-time availability
            </li>
            <li>
              Some books may be cataloged under variant ISBNs not included in
              the search list
            </li>
            <li>
              Book classification is automated and may contain errors,
              especially for lesser-known titles
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
