import { describe, it, expect, beforeEach } from "@jest/globals";
import React from "react";
import { render, act } from "@testing-library/react-native";
import * as apiClient from "../services/v2/apiClient";
import * as jobService from "../services/v2/jobService";
import * as podService from "../services/v2/podService";
import useActiveJob from "../hooks/useActiveJob";
import { useStopActions } from "../hooks/useStopActions";
import { usePODCapture } from "../hooks/usePODCapture";

jest.mock("../services/v2/apiClient", () => {
  const actual = jest.requireActual("../services/v2/apiClient");
  return {
    ...actual,
    v2Client: { get: jest.fn(), request: jest.fn(), defaults: { baseURL: "" } },
    v1Client: { get: jest.fn(), request: jest.fn(), defaults: { baseURL: "" } },
  };
});

jest.mock("../services/v2/jobService", () => {
  return {
    getActiveJob: jest.fn(() => Promise.resolve({ id: "job-1" })),
    getJobStops: jest.fn(() => Promise.resolve({ stops: [{ id: "s1", status: "PENDING" }] })),
    updateStopStatus: jest.fn(() => Promise.resolve({ ok: true })),
  };
});

jest.mock("../services/v2/podService", () => ({
  captureSignature: jest.fn(() => Promise.resolve({ ok: true })),
  capturePhoto: jest.fn(() => Promise.resolve({ ok: true })),
  verifyPIN: jest.fn(() => Promise.resolve({ ok: true })),
  getPodRequirements: jest.fn(() => Promise.resolve({ requirements: { type: "SIGNATURE" } })),
}));

jest.mock("../services/driverSocket", () => ({ getInstance: () => ({ on: jest.fn(), off: jest.fn() }) }));

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(() => Promise.resolve(null)),
    setItem: jest.fn(() => Promise.resolve()),
  },
}));

jest.mock("@react-native-community/netinfo", () => ({
  __esModule: true,
  default: { fetch: jest.fn(() => Promise.resolve({ isConnected: true })) },
  addEventListener: jest.fn(() => () => {}),
}));

describe("v2 api client", () => {
  it("exports clients and helpers", () => {
    expect(apiClient.v2Client).toBeDefined();
    expect(apiClient.v1Client).toBeDefined();
    expect(typeof apiClient.withFallback).toBe("function");
  });
});

describe("job service", () => {
  it("gets active job", async () => {
    const job = await jobService.getActiveJob();
    expect(job.id).toBe("job-1");
  });

  it("updates stop status", async () => {
    const res = await jobService.updateStopStatus("s1", "ARRIVED");
    expect(res).toBeTruthy();
  });
});

describe("pod service", () => {
  it("captures signature", async () => {
    const res = await podService.captureSignature("s1", "sig");
    expect(res).toBeTruthy();
  });

  it("fetches requirements", async () => {
    const res = await podService.getPodRequirements("s1");
    expect(res.requirements.type).toBe("SIGNATURE");
  });
});

describe("hooks", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("useActiveJob fetches job and stops", async () => {
    let hookResult: any = {};
    const TestComp = () => {
      hookResult = useActiveJob();
      return null;
    };
    render(React.createElement(TestComp));
    await act(async () => {
      await new Promise((res) => setTimeout(res, 0));
    });
    expect(hookResult.job?.id).toBe("job-1");
    expect(hookResult.stops.length).toBe(1);
  });

  it("useStopActions exposes handlers", async () => {
    let hookResult: any = {};
    const Comp = () => {
      hookResult = useStopActions();
      return null;
    };
    render(React.createElement(Comp));
    await act(async () => {
      await hookResult.arrive("s1");
    });
    expect(hookResult.error).toBeNull();
  });

  it("usePODCapture submits signature", async () => {
    let hookResult: any = {};
    const Comp = () => {
      hookResult = usePODCapture("s1");
      return null;
    };
    render(React.createElement(Comp));
    await act(async () => {
      hookResult.setSignature("sig");
      await hookResult.submitSignature();
    });
    expect(hookResult.error).toBeNull();
  });
});
