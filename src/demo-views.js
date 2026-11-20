export const demoViews = {
  envelope: {
    view: 'envelope',
    name: 'Buildable envelope',
    description: 'The road-height plane and setbacks trim the modeled volume as it rises.',
    imageAlt: 'Stepped buildable envelope within the mapped Bang Son neighborhood',
    primaryLabel: 'Plot area', primary: '1,043.8 m²',
    secondaryLabel: 'Base FAR budget', secondary: '6,262.6 m²',
  },
  garden: {
    view: '0',
    name: 'Garden Court',
    description: 'A three-storey residential concept with a broad open area and room for planting on the irregular plot.',
    imageAlt: 'Three-storey Garden Court massing among the mapped Bang Son buildings',
    primaryLabel: 'Example gross floor area', primary: '940 m²',
    secondaryLabel: 'Roof height', secondary: '9 m',
  },
  compact: {
    view: '1',
    name: 'Compact Stack',
    description: 'A four-storey residential concept that uses a smaller ground footprint and puts more floor area higher up.',
    imageAlt: 'Four-storey Compact Stack massing on the same plot in Bang Son',
    primaryLabel: 'Example gross floor area', primary: '970 m²',
    secondaryLabel: 'Roof height', secondary: '12 m',
  },
}

export function fromDemoURL(search) {
  const variant = new URLSearchParams(search).get('view')
  return Object.hasOwn(demoViews, variant) ? demoViews[variant].view : 'envelope'
}
