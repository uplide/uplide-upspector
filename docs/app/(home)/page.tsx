import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="flex flex-col justify-center items-center text-center flex-1 gap-4 px-4">
      <h1 className="text-3xl font-bold">debugbar</h1>
      <p className="max-w-xl text-fd-muted-foreground">
        A per-request debug bar for a NestJS backend and a React / Next.js
        frontend: SQL, outbound HTTP, cache, logs and timers for every request,
        shown in an overlay next to the page that made it.
      </p>
      <Link
        href="/docs"
        className="rounded-md bg-fd-primary px-4 py-2 font-medium text-fd-primary-foreground"
      >
        Read the docs
      </Link>
    </div>
  );
}
