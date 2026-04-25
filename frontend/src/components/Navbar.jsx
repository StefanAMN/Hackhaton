import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 30);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const navLinks = [
    { label: 'How It Works', href: '#how-it-works' },
    { label: 'Workspace', href: '#workspace' },
    { label: 'Impact', href: '#metrics' },
  ];

  return (
    <motion.nav
      className={`navbar ${scrolled ? 'scrolled' : ''}`}
      initial={{ y: -60, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="navbar-inner">
        <a href="#" className="navbar-logo" id="navbar-logo">
          <div className="navbar-logo-icon">
            <div className="ring ring-outer" />
            <div className="ring ring-inner" />
            <div className="dot" />
          </div>
          CodeLens
        </a>

        <div className={`navbar-links ${mobileOpen ? 'mobile-open' : ''}`}>
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="navbar-link"
              id={`nav-${link.label.toLowerCase().replace(/\s+/g, '-')}`}
              onClick={() => setMobileOpen(false)}
            >
              {link.label}
            </a>
          ))}
          <button className="btn btn-primary navbar-cta" id="navbar-cta-btn">
            Get Early Access
          </button>
        </div>

        <button
          className={`navbar-mobile-toggle ${mobileOpen ? 'open' : ''}`}
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle navigation menu"
          id="navbar-mobile-toggle"
        >
          <span />
          <span />
          <span />
        </button>
      </div>
    </motion.nav>
  );
}
