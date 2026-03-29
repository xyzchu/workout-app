import './globals.css'

export const metadata = {
  title: 'Workout Tracker',
  description: 'Track your workouts with timers and cloud sync',
  viewport: 'width=device-width, initial-scale=1, maximum-scale=1',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="bg-gray-950 text-gray-100 antialiased">
        {children}
      </body>
    </html>
  )
}