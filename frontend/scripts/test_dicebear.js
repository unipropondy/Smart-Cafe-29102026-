const { adventurer } = require('@dicebear/collection');
console.log('adventurer schema properties:', Object.keys(adventurer.schema.properties));
console.log('adventurer values:');
console.log('features:', adventurer.schema.properties.features?.default);
console.log('clothing:', adventurer.schema.properties.clothing?.default);
console.log('hair:', adventurer.schema.properties.hair?.default);
console.log('hat:', adventurer.schema.properties.hat?.default);
console.log('mouth:', adventurer.schema.properties.mouth?.default);
