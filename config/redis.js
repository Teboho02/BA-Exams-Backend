import redis from 'redis';

export const client = redis.createClient({
    socket: {
        port: 6379,
        host: 'localhost'
    }
})

client.connect();

client.on('error', (err) => console.log('Redis error', err));


await client.set('name','John Doe');

const name = await client.get('name');

console.log(name);