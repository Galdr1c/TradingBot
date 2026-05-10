import axios from 'axios';

const API_BASE = "http://localhost:8000/api";

export const getTickers = async (symbols) => {
    const res = await axios.get(`${API_BASE}/market/tickers?symbols=${symbols}`);
    return res.data;
};

export const getHistory = async (symbol) => {
    const res = await axios.get(`${API_BASE}/market/history/${symbol}`);
    return res.data;
};

export const getPrediction = async (symbol) => {
    const res = await axios.get(`${API_BASE}/predict/${symbol}`);
    return res.data;
};
