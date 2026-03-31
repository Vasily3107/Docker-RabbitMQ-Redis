const mongoose = require('mongoose');

const connection_string = ''

mongoose.connect(connection_string)
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('Could not connect to MongoDB', err));


const userSchema = new mongoose.Schema({
    name: String,
    password: String,
    role: { type: String, enum: ['user', 'admin'], default: 'user' }
});
const User = mongoose.model('User', userSchema);

const eventSchema = new mongoose.Schema({
    title: String,
    date: String,
    max_num_of_members: Number
});
const Event = mongoose.model('Event', eventSchema);

const bookingSchema = new mongoose.Schema({
    user_id: String,
    event_id: String
});
const Booking = mongoose.model('Booking', bookingSchema);


module.exports = {
    User,
    Event,
    Booking
}