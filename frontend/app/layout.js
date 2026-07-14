import './globals.css';

export const metadata = {
  title: 'Freelance Marketplace',
  description: 'African-focused freelance marketplace — Web Dev, Design, Video Editing, Writing.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="site-header-inner">
            <a href="/" className="site-header-logo">Kazi</a>
            <nav className="site-header-nav">
              <a href="/jobs">Browse jobs</a>
              <a href="/jobs/new">Post a job</a>
            </nav>
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
