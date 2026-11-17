import React from 'react';

export const metadata = {
  title: 'Next.js Zoetrope Player Example',
  description: 'SSR-safe client component example with Zoetrope',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0, backgroundColor: '#0b0c10', color: '#fff' }}>
        {children}
      </body>
    </html>
  );
}
