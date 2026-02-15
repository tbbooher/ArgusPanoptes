export function Footer() {
  return (
    <footer className="border-t border-gray-800 bg-gray-950 py-8">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
          <p className="text-sm text-gray-500">
            Argus Panoptes &mdash; Texas Library Holdings Report
          </p>
          <p className="text-sm text-gray-600">
            Data sourced from 260+ public library catalogs
          </p>
        </div>
      </div>
    </footer>
  );
}
