"use client";

import { SnowflakeIcon } from "@phosphor-icons/react/ssr";

const FLAKES = [
  { left: "8%", delay: "0s", duration: "7s", size: 12 },
  { left: "16%", delay: "0.7s", duration: "9s", size: 14 },
  { left: "24%", delay: "1.4s", duration: "6s", size: 10 },
  { left: "33%", delay: "0.3s", duration: "11s", size: 13 },
  { left: "41%", delay: "2.1s", duration: "8s", size: 11 },
  { left: "50%", delay: "0.9s", duration: "7.5s", size: 15 },
  { left: "58%", delay: "1.6s", duration: "10s", size: 12 },
  { left: "66%", delay: "0.5s", duration: "6.5s", size: 10 },
  { left: "75%", delay: "1.2s", duration: "9.5s", size: 14 },
  { left: "83%", delay: "2.8s", duration: "7s", size: 11 },
  { left: "91%", delay: "0.4s", duration: "8.5s", size: 13 },
  { left: "97%", delay: "1.9s", duration: "6s", size: 12 },
];

export function Snow() {
  return (
    <div
      aria-hidden="true"
      className="snow pointer-events-none fixed inset-0 overflow-hidden motion-reduce:hidden"
      style={{ zIndex: 0 }}
    >
      {FLAKES.map((f, i) => (
        <span
          key={i}
          className="absolute select-none"
          style={{
            top: "-24px",
            left: f.left,
            color: "rgba(255, 255, 255, 0.88)",
            filter: "drop-shadow(0 0 5px rgba(169, 205, 236, 0.6))",
            animation: `fall ${f.duration} linear ${f.delay} infinite`,
          }}
        >
          <SnowflakeIcon size={f.size} />
        </span>
      ))}
    </div>
  );
}
