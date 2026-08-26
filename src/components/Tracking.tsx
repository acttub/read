"use client";

import { useEffect } from "react";
import { initializeGa4, trackVisit } from "../lib/tracking";

export function Tracking() {
  useEffect(() => {
    initializeGa4();
    trackVisit();
  }, []);

  return null;
}
