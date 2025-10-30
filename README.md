# Driver App V1

TaxiTime-aligned React Native application for A&B Taxi drivers.  
This project lives alongside the legacy prototypes so we can migrate features gradually while keeping the updated visual language.

## Structure

- `App.tsx` – root component bootstrapping the shared theme.
- `src/theme` – color tokens and theme context derived from TaxiTime Version Two.
- `src/components/design` – first wave of reusable UI elements (Typography, buttons, etc. as they are added).
- `src/screens` – feature screens to be implemented incrementally.
- `src/services` – API clients and background services (placeholders for upcoming steps).

## Next Steps

1. Scaffold navigation shell (stack + auth flow).
2. Port shared UI primitives (buttons, cards, badges).
3. Introduce auth context + AsyncStorage persistence.
4. Integrate backend endpoints leveraging existing REST contracts.

> Installation requires the usual React Native toolchain (Android Studio / Xcode) and use of the repo-wide `.nvmrc` Node version.
