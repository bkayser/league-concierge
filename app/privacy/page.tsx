import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy – OYSA Resource Page",
};

const CONTACT_EMAIL = "help@askfooty.com";
const LAST_UPDATED = "October 24, 2026";

export default function PrivacyPage() {
  return (
    <main className="max-w-2xl mx-auto px-4 py-8 text-sm leading-relaxed text-gray-800">
      <Link href="/" className="text-green-700 underline hover:text-green-900">
        ← Back to Footy
      </Link>

      <h1 className="text-2xl font-bold mt-4 mb-1">Privacy Policy</h1>
      <p className="text-gray-500 mb-6">Last updated {LAST_UPDATED}</p>

      <p className="mb-4">
        This policy covers the Footy chat assistant at
        footy.oregonyouthsoccer.org (&ldquo;the site&rdquo;). It explains what
        we collect when you use it and what we do with it.
      </p>

      <h2 className="text-base font-semibold mt-6 mb-1">What we collect</h2>
      <ul className="list-disc pl-5 space-y-1 mb-4">
        <li>
          <strong>Your questions and Footy&rsquo;s answers.</strong> Whatever
          you type is sent to our server and stored with the answer.
        </li>
        <li>
          <strong>Ratings and comments</strong> if you use the thumbs
          up/down buttons.
        </li>
        <li>
          <strong>A random session ID</strong> that groups messages from one
          visit. It is generated in your browser, is not stored there, and
          changes when you reload the page.
        </li>
      </ul>
      <p className="mb-4">
        We do not ask for your name, email, or account details, and we do not
        use cookies, advertising trackers, or analytics. Our hosting provider
        may keep standard server logs (such as IP address and browser type)
        for security and operations.
      </p>
      <p className="mb-4">
        <strong>Please don&rsquo;t enter personal information</strong> (names,
        phone numbers, addresses, health details) in your questions. Footy
        doesn&rsquo;t need it to answer.
      </p>

      <h2 className="text-base font-semibold mt-6 mb-1">How we use it</h2>
      <p className="mb-4">
        To generate answers, and to review answer quality and fix problems. We
        do not sell your information or use it for advertising.
      </p>

      <h2 className="text-base font-semibold mt-6 mb-1">Who processes it</h2>
      <p className="mb-2">
        Providers that process data on our behalf under their own terms and
        privacy policies:
      </p>
      <ul className="list-disc pl-5 space-y-1 mb-4">
        <li>Anthropic &mdash; generates Footy&rsquo;s answers from your conversation.</li>
        <li>OpenAI &mdash; converts your latest question into a numeric form used for search.</li>
        <li>Pinecone &mdash; searches OYSA documents using that numeric form.</li>
        <li>Neon &mdash; database that stores conversation logs and ratings.</li>
        <li>Vercel &mdash; hosts the site.</li>
      </ul>
      <p className="mb-4">
        These providers may process data in the United States and elsewhere.
        We may also disclose information if required by law.
      </p>

      <h2 className="text-base font-semibold mt-6 mb-1">How long we keep it</h2>
      <p className="mb-4">
        Conversation logs are kept until we delete them; there is no fixed
        schedule. You can ask us to delete yours (see below).
      </p>

      <h2 className="text-base font-semibold mt-6 mb-1">Children</h2>
      <p className="mb-4">
        The site is intended for parents, coaches, players, and administrators
        and is not directed to children under 13. We do not knowingly collect
        personal information from them. If you believe a child has provided
        personal information, contact us and we will delete it.
      </p>

      <h2 className="text-base font-semibold mt-6 mb-1">Your choices</h2>
      <p className="mb-4">
        You may ask to see or delete conversations you had with Footy. Because
        we don&rsquo;t know who you are, tell us what you asked and roughly
        when so we can find it. Depending on where you live (for example,
        California or the EU/UK) you may have additional legal rights over
        your personal information; we will honor valid requests.
      </p>

      <h2 className="text-base font-semibold mt-6 mb-1">Security and changes</h2>
      <p className="mb-4">
        Data is sent over encrypted connections and access to logs is limited
        to administrators, but no system is perfectly secure. We may update
        this policy; the date above shows the latest version.
      </p>

      <h2 className="text-base font-semibold mt-6 mb-1">Contact</h2>
      <p>
        Questions or requests:{" "}
        <a
          href={`mailto:${CONTACT_EMAIL}`}
          className="text-green-700 underline hover:text-green-900"
        >
          {CONTACT_EMAIL}
        </a>
      </p>
    </main>
  );
}
