"use client";

import { useEffect } from "react";

/**
 * The landing page's only client JS: reveal-on-scroll for `.reveal` elements and
 * a hairline border on the nav once scrolled. Renders nothing.
 */
export function LandingEffects() {
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.16 },
    );
    document.querySelectorAll(".landing .reveal").forEach((el) => io.observe(el));

    const nav = document.getElementById("lp-nav");
    const onScroll = () => nav?.classList.toggle("scrolled", window.scrollY > 20);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return null;
}
