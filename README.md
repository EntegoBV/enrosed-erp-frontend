# Enrosed — Sales & Sourcing (frontend)

Angular 22 op een Quarkus-backend. De backend staat in
[enrosed-erp-backend](https://github.com/EntegoBV/enrosed-erp-backend).

Mobile first: telefoon krijgt een tabbalk onderaan, desktop een zijbalk vanaf 1024 px. Dat is
geen stijlkeuze — dit draait op een beurs, op een telefoon, met een klant naast je.

De **rekenregels, de offerteflow, de talen en de BTW-behandeling** zitten aan de backendkant
en staan daar gedocumenteerd. Dit bestand gaat alleen over de app zelf.

## Starten

**Eerst de backend**, anders heeft dit scherm niets om mee te praten.

```bash
npm install
```

```bash
npm start
```

| | |
|---|---|
| App | <http://localhost:4321> |
| API | <http://localhost:8080> |

**Aanmelden:** `enrosedadmin` en het bijbehorende wachtwoord.

## Wat je moet weten voor je iets aanpast

**Standalone componenten, signals, zoneless.** Geen NgModules en geen zone.js. State zit in
`signal()`, afgeleide waarden in `computed()`. Wie `setTimeout` gebruikt om iets zichtbaar te
maken zit fout: dan mist er een signal.

**Het klantportaal is een aparte weergave, geen versie van ons scherm met velden verborgen.**
Kostprijs en marge zitten niet in het antwoord van de server, dus ze kunnen ook niet
per ongeluk in beeld komen. De teksten van dat scherm komen mee met de offerte, zodat de PDF,
de mail en het portaal in dezelfde woorden staan.

**Dubbelklik op het logo** zet inkoopcijfers aan en uit, overal tegelijk (`Privacy`). Staat
het aan, dan kleurt de hele app rozerood in plaats van groen — dat zie je van de andere kant
van een beursstand. Groen is dus de veilige stand.

**Datums en weken** hebben eigen velden (`DateField`, `WeekField`). Een `<input type="date">`
toont de datum in de taal van de **browser**, niet van de pagina, en een `<input type="week">`
heeft in Safari en Firefox helemaal geen kiezer. Gebruik die twee componenten, geen kale
inputs.

**Aantallen** worden op volle dozen afgerond: de melding verschijnt meteen, het veld springt
na twee seconden. Die vertraging is er omdat je anders niet kan typen — wie 240 intikt is na
de eerste toets bij "2".

## Structuur

```
src/app/
  core/api/     modellen, HTTP-clients, auth, gedeelde diensten
  shared/       componenten en pipes die overal terugkomen
  features/     één map per scherm
```

`core/api/models.ts` is de enige plaats waar de vorm van de backendgegevens staat.

## Bouwen

```bash
npm run build
```

De uitvoer komt in `dist/enrosed`. De backend serveert die niet zelf; zet er een webserver
voor of host hem apart.
